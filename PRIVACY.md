# Política de Privacidade — Griffin Music

O Griffin Music é um aplicativo desktop **local-first**. A biblioteca, os projetos, a reprodução e a separação local funcionam sem uma conta do Griffin e sem enviar o áudio para servidores do projeto.

## Resumo

- **Sem telemetria ou analytics.** O Griffin não envia métricas de uso, identificadores de dispositivo ou relatórios de falha automaticamente.
- **Áudio local por padrão.** Importação de arquivos, separação ONNX, análise, pitch/tempo, mixagem, exportação, projetos e preferências são processados no computador.
- **Rede limitada e identificável.** O aplicativo verifica atualizações assinadas, baixa recursos técnicos quando necessário e só envia uma faixa a um serviço de separação em nuvem após consentimento explícito.
- **Sem servidor próprio de dados.** Não existe um servidor do Griffin/W3TI recebendo biblioteca, projetos, logs ou preferências.

## Dados mantidos no computador

O diretório de dados do Griffin pode conter:

- referências aos arquivos de áudio importados e cópias criadas por importações remotas;
- stems separados e arquivos temporários de processamento;
- biblioteca, projetos, pastas, snapshots, letras, acordes e dados de análise;
- preferências em `settings.json`;
- modelos ONNX, runtime NVIDIA opcional e `yt-dlp`;
- logs técnicos de sessão e um relatório local quando a sessão anterior termina inesperadamente.

Os arquivos `.gfn` guardam um manifesto do projeto e referências aos áudios; não incorporam automaticamente os arquivos de origem. A localização exata do diretório de dados depende do sistema operacional. Para fins de diagnóstico, **Preferências → Sobre → Abrir logs** abre a subpasta local de logs.

## Acessos automáticos à internet

### Verificação de atualização

Ao iniciar e, enquanto permanecer aberto, em intervalos de aproximadamente seis horas, o Griffin consulta o manifesto assinado da versão mais recente no GitHub Releases. Essa consulta não inclui sua biblioteca, seus projetos, seus áudios ou os logs do aplicativo. Como em qualquer conexão HTTPS, o GitHub e a infraestrutura de rede podem receber dados técnicos da requisição, como endereço IP, horário e agente de conexão.

O download e a instalação de uma atualização continuam sob controle do usuário. Instalações gerenciadas pelo sistema, como pacotes do Open Build Service, podem usar o atualizador da própria distribuição.

### Preparação e retomada de recursos locais

Na primeira separação, o Griffin pode baixar os modelos ONNX necessários. Quando você instala suporte NVIDIA ou `yt-dlp`, os respectivos recursos são obtidos das fontes oficiais configuradas no aplicativo. Se um desses downloads ficar incompleto, o Griffin pode verificar e retomar a preparação na abertura seguinte.

Essas requisições baixam somente recursos do aplicativo; não enviam áudio, biblioteca ou projetos. Os arquivos recebidos são verificados antes do uso.

## Acessos iniciados pelo usuário

### Importação de URL pública ou YouTube

Ao informar uma URL de áudio pública ou um link do YouTube, o Griffin consulta e baixa o conteúdo solicitado. A conexão é feita com o endereço informado, seus redirecionamentos validados e, no caso do YouTube, com os serviços acessados pelo `yt-dlp`. O Griffin não navega por esses serviços por conta própria e não contorna DRM, playlists ou restrições técnicas.

Use somente conteúdo que você tenha direito ou autorização para baixar e consulte os termos e a política de privacidade da fonte.

### Separação remota opcional com StemSplit

O Griffin oferece o StemSplit como alternativa opcional ao motor local. O recurso:

- fica indisponível até que o usuário configure e valide sua própria chave de API;
- pede consentimento antes de cada envio e apresenta custo estimado e resumo de retenção;
- envia somente a faixa selecionada, nunca a biblioteca inteira, projetos, preferências ou logs;
- baixa os stems produzidos para o cache local;
- mantém a separação local disponível sem conta ou internet.

A chave é armazenada no cofre nativo quando o sistema oferece esse recurso. No Linux, o fallback é um arquivo separado com acesso restrito ao usuário. A chave não é gravada em `settings.json`, incluída em diagnósticos nem enviada ao Griffin/W3TI.

O tratamento do áudio enviado passa a seguir os termos do StemSplit. Segundo a política consultada em 4 de agosto de 2026, uploads diretos podem manter o original por até 48 horas, os stems por até 14 dias e metadados da submissão por até 90 dias. Consulte sempre a [política vigente do StemSplit](https://stemsplit.io/legal/privacy-policy) antes de usar. Os detalhes da integração estão em [`docs/REMOTE_SEPARATION.md`](docs/REMOTE_SEPARATION.md).

## Diagnósticos e logs

O Griffin registra localmente eventos técnicos de sessão para ajudar a investigar falhas. O relatório gerado em **Preferências → Sobre** limita o conteúdo dos logs, substitui o caminho do diretório de dados e não inclui áudio ou chave de API.

Nada é enviado automaticamente. **Copiar diagnóstico** apenas coloca o relatório na área de transferência; **Salvar relatório** grava no local escolhido; **Abrir logs** abre a pasta local. Revise o conteúdo antes de publicá-lo em uma issue.

## O que o Griffin não faz

- Não exige conta, login ou cadastro para os recursos locais.
- Não vende dados nem inclui SDK de publicidade, analytics ou telemetria.
- Não envia relatórios de falha, logs, projetos ou preferências automaticamente.
- Não usa as faixas locais para treinar modelos; o modelo ONNX é baixado pronto e executado localmente.
- Não envia áudio a um provedor de separação sem a confirmação exibida antes da operação.

## Código aberto e contato

O código-fonte permite auditar os comandos de rede, o armazenamento e a ausência de telemetria. Para dúvidas, preocupações de privacidade ou correções neste documento, abra uma issue no [repositório do Griffin](https://github.com/britors/Griffin/issues).
