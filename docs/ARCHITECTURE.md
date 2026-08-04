# Arquitetura do Griffin Music

O Griffin Music é um aplicativo desktop Tauri 2. A interface usa React 19 e Zustand; o runtime nativo, a persistência e as integrações ficam em Rust. A separação ONNX é isolada em um processo auxiliar para que uma falha ou pico de memória não derrube o renderer.

```text
React / Zustand
      │ contratos tipados + invoke
      ▼
Comandos Tauri em Rust ───────► arquivos locais / diálogos / rede
      │
      └── JSON Lines ─────────► griffin-onnx-worker ─► ONNX Runtime
```

## Limites do runtime

- `src/renderer`: composição visual, navegação, estado do player, Web Audio e chamadas à API Tauri.
- `src/renderer/api.ts`: fachada tipada dos comandos nativos e dos eventos de progresso.
- `src/shared`: tipos e regras serializáveis compartilhados. `AudioTrack` é a raiz da biblioteca e `MusicProject` representa a organização e o estado salvo.
- `src-tauri/src/lib.rs`: composition root, plugins e lista explícita de comandos permitidos.
- `src-tauri/src/commands.rs`: importação, análise, separação, exportação, preparação de recursos, diagnóstico e integrações de sistema/rede.
- `src-tauri/src/state.rs`: estado concorrente, diretório de dados, leitura e gravação persistente.
- `src-tauri/src/updater.rs`: descoberta, download, cancelamento e instalação de atualizações assinadas.
- `src-tauri/src/bin/griffin-onnx-worker.rs`: processo auxiliar que carrega o ONNX Runtime e separa os stems.
- `src/main/application` e `src/main/infrastructure`: implementação TypeScript pura mantida como referência de domínio e cobertura de testes. Ela não é carregada pelo aplicativo Tauri em produção.

Não existe processo Electron nem script de preload. O renderer conversa somente com comandos Tauri registrados e a política CSP de produção não libera acesso direto a hosts externos; operações de rede ficam no lado nativo.

## Persistência local

O aplicativo preserva a localização histórica `GriffinMusic` dentro do diretório de configuração do usuário. Entre os artefatos principais estão:

```text
GriffinMusic/
├── library.json
├── projects.json
├── project-folders.json
├── settings.json
├── models/
├── stems/
├── imports/
├── logs/
├── session.active
└── unexpected-shutdown.txt
```

JSON persistente é escrito de forma atômica e pode usar cópia de segurança/recuperação quando um arquivo anterior está corrompido. Projetos `.gfn` são manifestos versionados: guardam estrutura e referências, mas não incorporam automaticamente áudio ou stems.

A chave do StemSplit fica fora de `settings.json`: usa o cofre nativo quando disponível e um arquivo restrito ao usuário como fallback no Linux.

## Reprodução

Há dois conjuntos de fontes de áudio mutuamente exclusivos:

1. Antes da separação, o arquivo importado toca em um canal dedicado chamado `original`.
2. Quando existem stems, cada stem é carregado em seu próprio canal e passa pelo mixer.

Pitch, tempo, posição, loop e equalização são coordenados pelo estado do player. O canal original tem EQ próprio e não é confundido com o stem `other`. Mixer por stem, gravação de take e exportação de mix/stems continuam dependentes de uma separação concluída.

## Separação local

1. O renderer invoca `separation_start` com a faixa e as opções escolhidas.
2. Rust resolve modelo, cache, perfil e provider, além de validar espaço e recursos.
3. Um único `griffin-onnx-worker` recebe a requisição por JSON Lines.
4. O worker verifica memória e formato, carrega o modelo e processa os stems sequencialmente.
5. Rust combina resultados novos com os stems em cache, atualiza `library.json` e devolve a faixa serializada.

O contrato principal usa entrada `mix [1, 2, 343980]`. O Demucs retorna `drums`, `bass`, `other` e `vocals`; o modelo opcional `htdemucs_6s.onnx` acrescenta `guitar` e `piano`. Processar um stem por vez limita o pico de RAM. Antes de decodificar a faixa, o worker exige 8 GiB de RAM disponível e, depois da decodificação, acrescenta ao orçamento os buffers estéreo da faixa. Uma medição de referência em CPU, com 30 segundos e um único stem, atingiu 8.353.508 KiB (aproximadamente 7,97 GiB) de RSS máximo; por isso, 8 GiB é um limite operacional, não uma estimativa de disco.

Modelos, runtime NVIDIA e `yt-dlp` são baixados por usuário, com verificação de integridade, progresso, pausa/cancelamento e retomada quando o servidor suporta intervalos. A preparação usa um orçamento de disco separado: 2 GiB menos os bytes parciais já válidos, com margem mínima de 512 MiB. O modo automático tenta CUDA quando o runtime está pronto e volta para CPU se necessário.

## Separação remota

O único runtime da integração StemSplit está em Rust. `separation_start` faz upload, cria e acompanha o job, baixa os resultados, atualiza o cache e persiste os stems. Não existe um SDK ou adaptador TypeScript paralelo.

Antes do upload, o backend valida chave, consentimento, arquivo, duração e limites próprios do Griffin. Cancelar interrompe o acompanhamento local; como o provedor não expõe cancelamento do job, o processamento remoto pode continuar. Consulte [REMOTE_SEPARATION.md](REMOTE_SEPARATION.md).

## Segurança e privacidade por desenho

- Somente comandos registrados em `src-tauri/src/lib.rs` podem ser invocados pelo renderer.
- Caminhos de biblioteca e destinos passam por validação antes de leitura ou escrita.
- Importações remotas exigem HTTPS público e bloqueiam destinos locais/privados e redirecionamentos inseguros.
- Downloads têm limites, timeout, cancelamento e, para recursos conhecidos, hash esperado.
- A CSP restringe scripts, mídia e conexões do renderer.
- Logs e diagnósticos ficam locais, têm tamanho limitado e não incluem chaves ou áudio.
- Nenhum relatório é transmitido automaticamente.

## Testes e build

Os testes Vitest cobrem regras do domínio TypeScript, store, player, importação, exportação e updater. Os testes Rust cobrem persistência, URLs, downloads, modelos, cache, protocolo do worker e comandos nativos sem exigir CUDA.

```bash
npm run typecheck
npm test
npm run build:frontend
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features gui
npm run validate:tauri
```

O build completo (`npm run build`) compila o renderer, o worker e os pacotes Tauri. Veja também [VALIDATION.md](VALIDATION.md) e [RELEASE.md](RELEASE.md).
