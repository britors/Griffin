# Releases do Griffin Music

A versão base do repositório é **3.0.4**. Releases são disparadas por tags `v*` e publicam pacotes Linux, instalador Windows, assinaturas e o manifesto do atualizador no GitHub Releases.

## Release 3.0.4

Esta versão restaura a exigência de **8 GiB de RAM disponível** para iniciar a separação local, evitando que o worker ONNX comece sem margem de memória suficiente.

## Release 3.0.3

Esta versão torna projetos Griffin portáteis entre computadores:

- exporta `.gfn` com áudio original, stems, análises, letras, gravações e snapshots;
- preserva pitch, tempo, loop, mixer, roteamento, equalização e mute/solo;
- importa as mídias para o armazenamento gerenciado do Griffin;
- continua abrindo os manifestos `.gfn` das versões anteriores;
- valida caminhos e limites do pacote antes da extração.

## Release 3.0.2

Esta versão melhora a experiência de separação local e refina a identidade visual:

- reduz para 2 GiB o piso de memória disponível exigido para iniciar a separação, mantendo no manual o alerta sobre o consumo real;
- amplia de 30 minutos para 3 horas o tempo máximo de uma separação local;
- adota um menu lateral roxo mais escuro e prolonga seu degradê até a área principal nos temas escuro e claro.

## Release 3.0.1

Esta versão reúne a evolução da interface e do fluxo de estudo:

- reprodução do arquivo original antes da separação, com pitch, tempo, loop e EQ próprios;
- menu lateral destacado e compacto, preservando os ícones;
- painel principal fluido, que preenche a área disponível ao maximizar, restaurar ou recolher o menu;
- verificação de espaço considerando downloads parciais de modelo, runtime NVIDIA e `yt-dlp`;
- ação para abrir a pasta de logs e melhorias no diagnóstico local;
- documentação alinhada ao runtime atual.

## Release 2.0.2

Corrige um estouro de pilha que podia fechar o Griffin durante o download ou atualização de `yt-dlp` e CUDA/cuDNN. Buffers de 1 MiB usados em SHA-256 e cópia passaram da pilha para o heap. A faixa de preparação também desaparece assim que a verificação termina.

## Release 2.0.1

Inclui preparação automática para usuários não técnicos, retomada e reparo de downloads, pausa durante download/separação, projetos `.gfn` com pastas e melhorias de estabilidade do worker ONNX. Diagnósticos permanecem locais e manuais.

## Empacotamento

O Tauri gera:

- Linux x86_64: `.deb` e `.rpm`;
- Windows 10/11 x64: instalador NSIS `.exe`;
- artefatos assinados aceitos pelo updater;
- `latest.json`, montado a partir dos assets reunidos em `release/`.

Os modelos ONNX, o runtime NVIDIA e `yt-dlp` não são empacotados. O aplicativo os baixa por usuário quando necessário. MSI não deve ser anunciado até existir um pacote MSI real.

Projetos `.gfn` atuais são pacotes ZIP versionados que incluem manifesto, áudios e stems. O Griffin continua importando os manifestos JSON versionados das releases anteriores; mudanças nesse contrato exigem migração e testes de compatibilidade.

## Assinatura e confiança

A chave privada nunca deve entrar no repositório. O workflow usa:

- `TAURI_SIGNING_PRIVATE_KEY`;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, quando a chave exigir senha.

A chave pública do updater Tauri fica em `src-tauri/tauri.conf.json`. O instalador Linux possui outra chave embutida em `scripts/install.sh`, substituível por `GRIFFIN_UPDATER_PUBLIC_KEY`.

**Atenção:** no código atual, essas duas chaves públicas embutidas não são idênticas. Antes de uma nova publicação, defina qual cadeia de assinatura será suportada, confirme que cada chave corresponde ao assinante usado no respectivo artefato e teste uma instalação/atualização real. Não troque uma chave já distribuída sem um plano de migração: instalações existentes deixarão de aceitar as novas assinaturas.

Para gerar uma chave Tauri:

```bash
npx tauri signer generate -w caminho/griffin-music.key
```

A perda da chave privada impede que instalações vinculadas à chave pública correspondente aceitem atualizações futuras.

O instalador Linux exige `curl` e `minisign`, baixa o pacote e o `.sig`, verifica a assinatura e somente depois chama `apt`, `dnf` ou `zypper`. Ausência do verificador ou assinatura inválida deve encerrar a instalação.

## Publicação no Open Build Service

O destino atual é:

- projeto: `home:rodrigosbrito`;
- pacote: `griffin-music`;
- spec versionado: `packaging/griffin.spec`.

Não use o projeto antigo `home:rodrigosbrito:lyra` nem o nome de pacote `griffin`. O script `scripts/validate-obs-spec.sh` confere versão, binários, worker ONNX, providers, desktop entry e ícones contra o RPM gerado.

## Validação antes da tag

Em uma árvore limpa e com dependências instaladas:

```bash
npm ci
npm run validate:version
npm run validate:tauri
npm run test:updater-manifest
npm run typecheck
npm test
npm run build:frontend
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features gui
```

No Linux, gere e valide os artefatos:

```bash
npm run package:linux
npm run validate:packages
npm run validate:obs-spec
```

No Windows 10/11 x64 ou no runner Windows:

```powershell
npm run package:win
./scripts/validate-windows-build.ps1
bash scripts/validate-packages.sh release windows
```

Além dos testes automatizados, execute o roteiro de [VALIDATION.md](VALIDATION.md), confira instalação sobre uma versão anterior, atualização assinada, desinstalação sem `--purge` e inicialização sem servidor Vite.

## Publicação

1. Atualize a versão de todos os manifestos cobertos por `npm run validate:version`.
2. Atualize esta documentação e as notas destinadas ao usuário.
3. Confirme secrets, chaves públicas e assinaturas em uma release de teste.
4. Crie e envie a tag `vX.Y.Z`.
5. Aguarde os jobs Linux e Windows e verifique os artefatos reunidos.
6. Confirme o `latest.json`, suas URLs, targets e assinaturas antes de divulgar.
7. Atualize `home:rodrigosbrito/griffin-music` no OBS e aguarde os builds publicados.

O workflow falha se a chave privada estiver ausente, se os pacotes esperados não forem encontrados ou se uma validação de layout falhar. Não publique manualmente um conjunto parcial como release estável.
