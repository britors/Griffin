# Validação do Griffin Music

Use este roteiro para mudanças no player, separação, recursos locais, persistência ou empacotamento. Trabalhe com áudio que você tenha autorização para usar e registre sistema, versão, formato e provider efetivo nos resultados.

## Verificação automatizada

Renderer e domínio TypeScript:

```bash
npm run typecheck
npm test
npm run build:frontend
```

Runtime Rust/Tauri:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features gui
npm run validate:tauri
```

Release e manifesto:

```bash
npm run validate:version
npm run test:updater-manifest
```

`npm run build:frontend` valida a interface sem montar um instalador. `npm run build` é o build Tauri completo e também compila o worker. As verificações de pacotes ficam em [RELEASE.md](RELEASE.md).

## Preparação de recursos

- Inicie sem o modelo padrão e execute a primeira separação.
- Confirme a mensagem de espaço em disco necessário e mantenha pelo menos 2 GiB livres.
- Pause e retome o download; feche e reabra o app com um arquivo parcial e confirme a retomada.
- Cancele e confirme que a interface volta a um estado utilizável.
- Corrompa apenas uma cópia descartável do recurso e confirme que a verificação oferece/realiza o reparo.
- Repita para o modelo estendido, `yt-dlp` e runtime NVIDIA quando aplicável.
- Confirme que o cálculo de espaço desconta bytes parciais válidos e nunca mostra valor negativo.

## Orçamento de memória da separação

- Confirme que menos de 8 GiB de RAM disponível bloqueia o worker com uma mensagem que menciona memória, não disco.
- Com pelo menos 8 GiB disponíveis, processe um trecho de 30 segundos em CPU e registre o RSS máximo com a ferramenta do sistema (`/usr/bin/time -v` no Linux). A referência atual para um único stem é 8.353.508 KiB (aproximadamente 7,97 GiB).
- Repita com uma faixa longa e confirme que o orçamento após a decodificação considera os buffers estéreo proporcionais à duração.
- Trate 16 GB de RAM total como recomendação ao usuário, pois sistema e outros aplicativos precisam deixar 8 GiB efetivamente disponíveis para o worker.

## Biblioteca e reprodução original

1. Importe WAV, MP3 e FLAC autorizados.
2. Selecione uma faixa ainda sem stems e reproduza imediatamente.
3. Teste play/pause, busca na forma de onda, saltos, Home e loop A-B.
4. Teste pitch de -12 a +12 e tempo de 50% a 150%; pitch não deve alterar a duração e tempo não deve alterar a tonalidade.
5. Ajuste o EQ **Original**, troque de faixa e volte; confirme o estado esperado.
6. Confirme que o canal **Original** não altera o estado do futuro stem **Outros**.
7. Mova ou remova uma cópia de teste do arquivo de origem e confira a mensagem de erro.

## Separação local e stems

1. Separe uma faixa no perfil padrão.
2. Confirme vocal, bateria, baixo e outros, sincronizados durante vários minutos.
3. Com o modelo estendido, confirme também guitarra e piano.
4. Teste extração de um único stem e preservação dos stems existentes.
5. Reabra a mesma faixa e confirme que o cache evita nova inferência compatível.
6. Altere perfil/provider e confirme que cache incompatível não é apresentado como novo resultado.
7. Teste modo **Automático**, fallback de CUDA para CPU e **Somente CPU**.
8. Teste pausa/cancelamento e confirme que progresso antigo não sobrescreve uma nova operação.

No mixer, valide volume, pan, roteamento L/R/estéreo, mute e solo. No EQ, alterne entre todos os stems e confirme que cada curva é independente. Teste loop, metrônomo, contagem e prática progressiva.

## Exportação e gravação

- Exporte mix e stems individuais em 44,1/48 kHz e 16/24 bits.
- Confirme seleção de stems, mute/solo, pan, EQ, pitch, tempo e loop no WAV.
- Confirme que um destino existente não é sobrescrito silenciosamente.
- Grave um take com dispositivo padrão e com uma interface disponível.
- Negue a permissão de microfone e confira se o erro é recuperável.
- Confirme que exportação e gravação não aparecem como disponíveis antes dos stems.

## Projetos e persistência

- Crie pastas, subpastas, projetos e snapshots; reinicie e confirme a restauração.
- Salve, feche e abra um `.gfn`.
- Abra uma cópia com áudio ausente e confirme que o projeto é preservado e lista as referências quebradas.
- Confirme que o `.gfn` não incorporou o áudio.
- Interrompa uma cópia de teste durante gravação de estado e confirme a recuperação atômica/backup.
- Limpe o cache e confirme que projetos, originais, modelos e preferências permanecem.

## Importações de rede e separação remota

- URL pública: valide prévia, confirmação de direitos, download, limites e bloqueio de URL local/privada.
- YouTube: valide vídeo individual, confirmação, ausência de playlists/DRM e atualização do `yt-dlp`.
- StemSplit: valide chave ausente, inválida e válida; confirme custo e retenção antes de cada envio.
- Teste os limites próprios do Griffin de 100 MB e 60 minutos sem fazer upload.
- Cancele após criar um job e confirme o aviso de que o processamento/cobrança pode continuar no provedor.
- Simule timeout, resposta incompleta e falha de download; o motor local deve continuar disponível.
- Revise logs e diagnóstico para garantir que chaves e áudio não apareçam.

## Interface e acessibilidade

- Teste tema claro/escuro, cor de destaque, fonte grande e alto contraste quando disponível.
- Oculte o menu lateral: ele deve reduzir para ícones, manter o botão sobre a borda e conservar tooltips/rótulos acessíveis.
- Maximize, restaure e redimensione até o mínimo configurado; cards não devem sair do painel nem manter largura antiga.
- Navegue com teclado, confira foco visível e valide os atalhos fora de campos de formulário.
- Teste mensagens de progresso e erro com zoom/tamanho de interface aumentado.

## Diagnóstico e encerramento

- Use **Copiar diagnóstico**, **Salvar relatório** e **Abrir logs**.
- Confirme que nenhum comando envia o relatório automaticamente.
- Revise a ausência de chave, áudio e caminho pessoal completo.
- Force um encerramento somente em ambiente de teste; na abertura seguinte, confirme o aviso da sessão anterior.
- Encerre normalmente e confirme que o aviso não reaparece.

## Windows e OBS Studio

1. Instale o NSIS em Windows 10 2004+ ou Windows 11 x64.
2. No OBS, adicione **Application Audio Capture (BETA)** para o Griffin.
3. Confirme que play/pause afeta somente essa fonte e que não há eco com o áudio global desativado.
4. Teste original, quatro stems e seis stems, incluindo mute, solo, pan, pitch e tempo.
5. Mantenha reprodução por pelo menos 15 minutos e confirme sincronismo e estabilização da memória.
6. Teste também **Window Capture** com captura de áudio em OBS 30.1+.

O roteiro específico está em [OBS_WINDOWS.md](OBS_WINDOWS.md).

## Evidência de aceite

Registre os comandos executados, contagem de testes, plataforma e testes manuais relevantes. Em falhas, anexe o diagnóstico revisado e somente trechos de log necessários; nunca inclua API keys ou áudio privado.
