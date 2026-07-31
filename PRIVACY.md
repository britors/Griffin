# Política de Privacidade — Griffin Music

O Griffin Music é um aplicativo desktop **local-first**: por padrão, seu áudio nunca sai do computador. Este documento descreve exatamente o que fica local, o que pode sair da máquina (só quando você ativa uma função opcional) e o que o aplicativo **não** faz.

## Resumo

- **Sem telemetria.** O Griffin não coleta métricas de uso, não envia analytics, não tem crash reporting remoto e não "liga para casa". Não há nenhum SDK de telemetria/analytics no código-fonte — qualquer pessoa pode conferir isso lendo o repositório.
- **Processamento local por padrão.** Separação de stems (ONNX), pitch/tempo, mixagem, exportação de áudio, metrônomo, cache, projetos e preferências — tudo roda e fica salvo no seu computador (`userData` do Electron), sem servidor próprio do Griffin.
- **Nada é enviado sem uma ação explícita sua.** As únicas funções que se comunicam com a internet são as descritas abaixo, e todas exigem uma ação direta (colar uma URL, colar um link do YouTube, ou configurar e usar deliberadamente a separação em nuvem).

## O que fica 100% local

- Arquivos de áudio importados e os stems separados (cache em disco).
- Projetos, favoritos, faixas recentes, letras, acordes, análise de BPM/tom/afinação.
- Preferências (tema, atalhos, threads de processamento etc.), salvas em `settings.json` no diretório de dados do app.
- O modelo ONNX de separação, baixado uma vez e armazenado localmente.

Nenhum desses dados é enviado a servidores do Griffin/W3TI — porque não existe um servidor do Griffin/W3TI para os receber.

## O que pode sair da máquina (funções opcionais)

### Importação de URL pública ou YouTube

Se você colar uma URL de áudio pública ou um link do YouTube na tela de importação, o Griffin faz uma requisição para baixar esse conteúdo (via `fetch` para a URL informada, ou via `yt-dlp` para o YouTube). Isso só acontece quando você fornece o link — o app não navega ou baixa nada por conta própria. Consulte os Termos de Serviço da fonte (ex. YouTube) antes de usar.

### Separação remota opcional (StemSplit)

O Griffin oferece, como alternativa **opcional** ao motor local, o envio da faixa para a API do [StemSplit.io](https://stemsplit.io) para separação em nuvem. Essa função:

- **Fica desativada por padrão** e só aparece na interface depois que você mesmo cria uma conta no StemSplit, gera uma chave de API e a cola em Preferências.
- **Pede consentimento explícito** antes de cada envio na sessão, mostrando que o áudio vai sair da máquina, o custo estimado e o resumo da política de retenção do StemSplit.
- Envia **apenas a faixa de áudio selecionada** no momento da separação — nada mais do seu computador, biblioteca ou preferências.
- Usa uma chave de API que você mesmo cria e controla, armazenada localmente cifrada (via `safeStorage` do Electron, quando o sistema operacional oferece essa proteção) — nunca commitada no repositório, nunca enviada para o Griffin/W3TI.

Detalhes técnicos completos (limites, retenção, comparação de provedores avaliados) estão em [`docs/REMOTE_SEPARATION.md`](docs/REMOTE_SEPARATION.md). A política de retenção de dados de terceiros é a do próprio StemSplit — consulte [stemsplit.io/en/legal/privacy-policy](https://stemsplit.io/en/legal/privacy-policy).

## O que o Griffin nunca faz

- Não coleta ou envia métricas de uso, identificadores de dispositivo ou logs para qualquer servidor.
- Não envia áudio, stems ou metadados de faixas para nenhum lugar, a menos que você ative e use explicitamente uma das funções opcionais acima.
- Não usa suas faixas para treinar modelos — nem localmente (o modelo ONNX é fixo, baixado pronto) nem remotamente (ver política do StemSplit).
- Não exige conta, login ou cadastro para usar as funções locais do aplicativo.

## Código aberto e verificável

Este é um projeto de código aberto. Qualquer alegação acima pode ser conferida diretamente no código-fonte — em particular, a ausência de telemetria pode ser confirmada pela ausência de qualquer dependência de analytics em `package.json` e pela busca por chamadas de rede em `src/main`.

## Dúvidas

Abra uma issue no repositório do projeto para relatar dúvidas, preocupações de privacidade ou sugestões relacionadas a este documento.
