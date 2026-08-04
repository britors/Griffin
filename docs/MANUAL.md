# Manual do Griffin Music

O Griffin Music é um aplicativo desktop para separar músicas em stems e estudar uma faixa com controle de velocidade, tonalidade, loop, metrônomo e mixagem. Ele funciona localmente por padrão: os arquivos, a separação, a análise, o cache e as preferências permanecem no computador.

Este manual descreve a versão 3.0.1 do projeto.

## 1. Instalação

### 1.1 Instalação por release

Baixe a versão correspondente ao seu sistema na página de [releases](https://github.com/britors/Griffin/releases/latest):

- Ubuntu ou Debian: arquivo `.deb`;
- Fedora, openSUSE ou outra distribuição compatível: arquivo `.rpm`;
- Windows 10/11 x64: instalador `.exe`;
- Arch ou Manjaro: `PKGBUILD` com `makepkg` ou pacote AUR, quando disponível.

No Linux, a instalação automática exige `curl` e `minisign`. O script baixa o pacote e seu arquivo de assinatura, verifica a assinatura e só então chama o gerenciador de pacotes:

```bash
curl -fsSL https://raw.githubusercontent.com/britors/Griffin/main/scripts/install.sh | sudo bash
```

Para remover o programa e preservar seus dados:

```bash
sudo bash scripts/uninstall.sh
```

Para remover também projetos, cache, modelos e preferências locais:

```bash
sudo bash scripts/uninstall.sh --purge
```

O modo `--purge` é irreversível. Exporte ou copie seus projetos antes de usá-lo.

### 1.2 Desenvolvimento a partir do código

Requisitos recomendados:

- Node.js 22.x e npm;
- Rust e Cargo;
- dependências de compilação do Tauri para Linux;
- pelo menos 2 GB livres para baixar, verificar e instalar o modelo ONNX, além de espaço para os artefatos de build.

```bash
git clone git@github.com:britors/Griffin.git
cd Griffin
npm ci
npm run dev
```

O primeiro build pode demorar mais porque compila o worker ONNX. Os modelos não ficam no repositório nem dentro do instalador; são baixados sob demanda pelo aplicativo.

## 2. Primeiro uso

1. Abra o Griffin Music.
2. Entre em **Biblioteca** e clique em **＋ Importar faixa**.
3. Escolha um arquivo de áudio local.
4. Selecione a faixa importada. O Griffin analisa BPM, tonalidade, afinação, seções e acordes localmente.
5. Na tela **Studio**, reproduza a faixa original imediatamente ou clique em **Separar stems**.
6. Na primeira separação, o Griffin baixa e verifica automaticamente o modelo, com download aproximado de 1 GB. O progresso pode ser pausado, cancelado e retomado.
7. Quando a separação terminar, use o mixer para estudar os stems individualmente.

O perfil padrão gera quatro stems: vocal, bateria, baixo e outros. Depois de instalar o modelo estendido em **Preferências → Processamento → Ativar guitarra e piano**, o perfil de seis stems também oferece guitarra e piano.

## 3. Navegação principal

A barra lateral contém:

- **Biblioteca**: todas as faixas do projeto atual;
- **Favoritos**: faixas marcadas com a estrela;
- **Recentes**: faixas reproduzidas recentemente;
- **Preferências**: aparência, reprodução, processamento, YouTube, separação na nuvem, OBS e atualizações.

O botão na borda superior da barra lateral oculta ou mostra os textos do menu. No modo compacto, os ícones continuam disponíveis e exibem o nome da seção como dica. A escolha é preservada neste computador.

Na Biblioteca, use o campo **Buscar na biblioteca** para filtrar faixas pelo nome. Uma faixa pode ser selecionada clicando em qualquer parte da linha. O botão `☆` adiciona aos favoritos e `×` remove a entrada da biblioteca.

Remover uma faixa não apaga automaticamente os stems em cache. Para liberar espaço, use **Preferências → Processamento → Limpar cache de stems**.

## 4. Importar áudio

### 4.1 Arquivo local

Clique em **＋ Importar faixa** e escolha um arquivo. A faixa é adicionada à biblioteca e, quando houver um projeto ativo, também é vinculada a esse projeto.

Para adicionar várias faixas e separá-las em sequência, use o painel **Processamento em lote**:

1. Clique em **＋ Adicionar arquivos**.
2. Selecione os arquivos.
3. Clique em **Iniciar fila**.
4. Acompanhe o progresso de cada item.
5. Use **Pausar após a faixa atual** para interromper a fila sem interromper a faixa em processamento.

A fila é preservada localmente e pode ser retomada depois de reiniciar o aplicativo. Uma separação em lote usa o motor local.

### 4.2 URL pública

No painel **Importar por URL**:

1. Cole a URL de um arquivo de áudio público.
2. Clique em **Pré-visualizar**.
3. Confira nome, formato, tamanho e duração.
4. Marque a confirmação de que você tem os direitos ou autorização.
5. Clique em **Importar para a biblioteca**.

O download e a conversão entram no pipeline local depois da confirmação. Não use fontes cujo conteúdo você não tenha autorização para baixar ou utilizar.

### 4.3 YouTube

No painel **Importar do YouTube**:

1. Cole a URL de um vídeo individual.
2. Clique em **Consultar vídeo**.
3. Confirme que o vídeo é seu, está sob licença compatível ou que você tem autorização.
4. Clique em **Baixar e importar**.

O Griffin não contorna DRM, playlists ou restrições técnicas. A importação depende do `yt-dlp`. A seção **Preferências → Importação do YouTube** instala o binário dentro da pasta de dados do Griffin e verifica o SHA-256 antes do uso. Python e FFmpeg não são exigidos pelo fluxo suportado no Windows.

Consulte os Termos de Serviço do YouTube e a legislação aplicável antes de usar essa função.

## 5. Separação de stems

Com uma faixa selecionada no Studio:

1. Escolha **Local** no campo **Motor**, quando a separação local estiver disponível.
2. Em **Extrair**, escolha **Todos os stems** ou um stem individual.
3. Clique em **Separar stems** ou **Extrair ...**.
4. Aguarde o progresso. O provider efetivo (`cpu` ou `cuda`) aparece no andamento e em **Provider ONNX**.

É possível extrair apenas um stem depois. Isso evita recalcular stems que já estão no cache.

### Perfis locais

Em **Preferências → Processamento**:

- **Qualidade máxima** prioriza `htdemucs_ft`;
- **Balanceado** usa uma combinação mais rápida quando disponível;
- **Velocidade** prioriza o modelo single-file quando disponível;
- **Aceleração → Automático** tenta GPU e volta para CPU se necessário;
- **Somente CPU** desativa CUDA;
- **Preferir GPU** tenta CUDA e mantém fallback para CPU.

O cache registra o provider usado. Assim, uma separação feita em CPU não é reutilizada indevidamente como se tivesse sido feita em CUDA, ou vice-versa.

### Separação remota opcional

O StemSplit só aparece como opção depois que uma chave verificada é configurada em **Preferências → Separação na nuvem (opcional)**.

1. Crie uma conta no StemSplit e gere sua própria API key.
2. Cole a chave e clique em **Salvar e testar**.
3. No Studio, escolha **Nuvem (StemSplit)**.
4. Confira a estimativa de custo e a informação de retenção.
5. Confirme **Enviar para a nuvem**.

O consentimento é solicitado antes de cada operação. A faixa selecionada é enviada ao StemSplit; a biblioteca e os demais arquivos não são enviados. Se a operação remota falhar, use **Tentar localmente**. A separação local continua disponível sem chave ou internet. Veja os limites e a retenção em [REMOTE_SEPARATION.md](REMOTE_SEPARATION.md).

## 6. Player e prática

### 6.1 Transporte

O painel do Studio oferece:

- **Play/Pause**: inicia ou pausa a reprodução;
- **↶ / ↷**: recua ou avança um pequeno trecho;
- **forma de onda**: navegação direta na faixa;
- **Loop**: liga ou desliga o loop A-B;
- **A** e **B**: marcam o início e o fim do trecho na posição atual;
- **Limpar**: remove as marcações do loop;
- **Pitch**: ajusta a tonalidade em semitons, de -12 a +12;
- **Tempo**: ajusta a velocidade entre 50% e 150%.

Antes da separação, esses controles atuam diretamente na reprodução do arquivo original. Depois da separação, atuam nos stems sincronizados. Pitch e tempo não alteram os arquivos gravados em disco; na exportação dos stems, os valores atuais são aplicados ao WAV gerado.

### 6.2 Análise e seções

Depois da análise local, BPM, tonalidade e afinação podem ser corrigidos diretamente nos campos exibidos no player. As alterações são salvas ao sair do campo.

As seções detectadas aparecem como marcadores. Clique no nome de uma seção para saltar até ela; edite o nome ou os limites em porcentagem e saia do campo para salvar.

Quando houver acordes, o acorde atual e o próximo aparecem no timeline. Clique em um acorde para navegar até ele e edite o nome diretamente. Os acordes podem ser exportados em **MIDI** ou **PDF**.

### 6.3 Reprodução original e mixer de stems

Uma faixa importada pode ser tocada sem esperar pela separação. Nesse estado, o player usa um canal **Original**, com equalização própria. Ele é separado do stem **Outros** (`other`).

Depois que a faixa possui stems, o Studio troca para a reprodução multicanal e libera o mixer. Cada stem disponível possui:

- volume individual;
- panorama (centro, esquerda ou direita);
- saída estéreo, canal L ou canal R;
- **M** para mute;
- **SOLO** para ouvir somente um stem.

O mixer, o EQ e o loop são aplicados também ao áudio exportado. Exportação, gravação de take e prática que depende de canais separados só ficam disponíveis depois da separação.

### 6.4 Equalizador

Use o equalizador gráfico para ajustar as bandas. Antes da separação, escolha **Original**; depois dela, escolha o stem desejado. Os presets facilitam correções rápidas, e o Griffin preserva ajustes independentes para o original e para cada stem no estado atual do player. Snapshots e projetos `.gfn` guardam esse estado.

### 6.5 Metrônomo e contagem

Ative o metrônomo em **Preferências → Reprodução**. Escolha:

- 1 clique por batida: semínima;
- 2 cliques por batida: colcheia;
- 4 cliques por batida: semicolcheia.

Ajuste o volume sem alterar os stems. Ative **Contagem antes de tocar** para ouvir uma ou duas barras antes do início. A contagem acompanha o BPM analisado e o tempo escolhido.

### 6.6 Prática progressiva

No painel **Prática progressiva**:

1. Defina **Início**, **Final**, **Incremento** e **Repetições** em porcentagem.
2. Marque um loop A-B.
3. Clique em **Ativar**.
4. Reproduza o loop.

O Griffin começa no percentual inicial e aumenta o tempo após o número definido de repetições, até atingir o limite final. Sem um loop A-B, a prática progressiva permanece aguardando.

### 6.7 Gravar um take

Quando houver stems separados, o painel **Gravar take** permite tocar junto com a faixa:

1. Escolha a entrada de microfone ou interface, ou mantenha **Dispositivo padrão**.
2. Confira o medidor de nível.
3. Clique em **● Gravar take**.
4. Toque durante a reprodução.
5. Clique em **Parar gravação**.

O take é salvo como uma nova faixa na biblioteca e pode ser sincronizado como uma camada sobre a faixa original. A gravação exige permissão de microfone do sistema.

## 7. Letras sincronizadas

No painel **Letras**:

- digite ou cole uma linha por vez na área de texto; ou
- clique em **Importar .txt** para escolher um arquivo de texto.

Clique em **Salvar letra**. As linhas são distribuídas automaticamente pela duração da faixa e o player destaca a linha correspondente durante a reprodução. A letra fica local e pode acompanhar o projeto.

## 8. Exportar áudio

O painel **Exportar** aparece depois que a faixa possui stems.

1. Marque os stems que deseja incluir.
2. Em **Tipo de saída**, escolha:
   - **Mixagem combinada** para gerar um único WAV;
   - **Arquivos individuais** para gerar um WAV por stem selecionado.
3. Escolha sample rate de 44,1 ou 48 kHz.
4. Escolha 16 ou 24 bits.
5. Opcionalmente, marque **Exportar somente o loop A-B**.
6. Clique em **Exportar WAV** ou **Exportar stems** e escolha o destino quando solicitado.

A exportação aplica volume, mute, solo, panorama, roteamento, EQ, pitch, tempo e loop. O Griffin não substitui arquivos existentes. O formato suportado neste fluxo é WAV PCM; MP3 e FLAC não são gerados localmente pela aplicação.

## 9. Projetos, pastas e snapshots

### 9.1 Organização

O painel **Projetos** permite criar projetos e pastas. Para organizar a biblioteca:

1. Clique em **＋ Projeto** para criar um projeto.
2. Clique em **＋ Pasta** para criar uma pasta.
3. Selecione a pasta e crie ou mova projetos para ela.
4. Use os botões de renomear ou remover conforme necessário.

Ao remover uma pasta, seus projetos vão para a pasta pai. Subpastas precisam ser movidas ou removidas antes que a pasta pai possa ser removida.

### 9.2 Arquivo `.gfn`

Use **Salvar como** para escolher o local de um arquivo `.gfn`. Depois, **Salvar** atualiza o mesmo arquivo. Use **Abrir .gfn** para abrir um projeto salvo.

O `.gfn` é um manifesto JSON versionado que contém o projeto, as pastas e referências das bibliotecas. Ele não copia os arquivos de áudio nem os stems; por isso, ao abrir em outro computador, as mesmas faixas precisam estar disponíveis nos caminhos esperados. Se isso não acontecer, o Griffin lista as faixas ausentes sem descartar o projeto.

Faça backup dos arquivos de áudio e do `.gfn` juntos quando quiser transportar um projeto. Não edite o `.gfn` manualmente enquanto o aplicativo estiver usando o projeto.

### 9.3 Snapshots

No painel **Snapshots**, clique em `＋`, dê um nome e salve o estado atual. Um snapshot preserva a seleção, posição, pitch, tempo, loop, mixer, roteamento, EQ e mute/solo. Clique em um snapshot para restaurá-lo ou em `×` para removê-lo.

Snapshots não substituem backup dos áudios e não criam cópias dos arquivos de origem.

## 10. Preferências

### Aparência

Escolha tema escuro ou claro, cor de destaque e tamanho normal ou grande da interface.

### Reprodução

Configure o reinício da posição ao trocar de faixa, o metrônomo, a subdivisão, o volume e a contagem de entrada. As preferências são salvas localmente.

### Processamento

Nesta seção você pode:

- acompanhar a preparação automática, pausar, retomar ou cancelar downloads;
- instalar ou verificar os modelos e conferir o espaço necessário;
- ativar o perfil de seis stems;
- escolher qualidade, velocidade e provider ONNX;
- instalar o runtime NVIDIA por usuário;
- ajustar threads;
- consultar espaço usado por modelo e cache;
- limpar o cache de stems.

O botão **Limpar cache** preserva faixas originais, projetos e modelos. Aguarde qualquer separação terminar antes de limpar o cache.

Se o Griffin for fechado ou o computador reiniciar durante a preparação, os downloads parciais de modelo, cuDNN e `yt-dlp` são retomados automaticamente na próxima abertura. O aplicativo valida os arquivos antes de usá-los e repara uma cópia incompleta ou corrompida sem exigir configuração técnica.

### OBS / Windows

No Windows, a integração recomendada é:

1. No OBS, adicione **Application Audio Capture (BETA)** e escolha a janela do Griffin Music.
2. Para capturar a imagem, adicione **Window Capture**.
3. Desative o áudio global do desktop no OBS para evitar eco.
4. Mantenha a mesma taxa de amostragem nos dois aplicativos; 48 kHz é recomendado para transmissão e gravação.

Se o OBS não listar o Griffin, use uma saída virtual do Windows como fallback e capture-a como **Audio Input Capture**. O Griffin não controla cenas, gravação ou transmissão do OBS.

### Sobre e atualizações

Em **Sobre**, consulte versão, licença e atualização. O atualizador verifica automaticamente o manifesto assinado ao abrir o app e aproximadamente a cada seis horas; baixar e instalar continuam sob seu controle. Atualize por cima da instalação existente para preservar os dados do usuário. A chave privada de assinatura nunca faz parte do instalador ou do repositório.

Na mesma seção, **Copiar diagnóstico** coloca um relatório técnico na área de transferência, **Salvar relatório** grava uma cópia no local escolhido e **Abrir logs** abre a pasta de logs. Nada é enviado automaticamente. Se a sessão anterior terminou de forma inesperada, o app mostra um aviso e inclui os eventos locais disponíveis no diagnóstico.

## 11. Atalhos de teclado

Os atalhos funcionam quando o foco não está em um campo de texto, seletor ou botão.

| Tecla | Ação |
| --- | --- |
| `Space` | Play/Pause |
| `←` / `→` | Recuar/avançar 5% |
| `Shift` + `←` / `→` | Recuar/avançar 1% |
| `Home` | Ir para o início |
| `L` | Ativar/desativar loop |
| `A` | Marcar início do loop |
| `B` | Marcar fim do loop |
| `M` | Silenciar ou reativar todos os stems |
| `[` / `]` | Diminuir/aumentar o tempo em 5 pontos percentuais |

## 12. Solução de problemas

### O modelo não baixa

Verifique internet, espaço livre e permissões da pasta de dados. O Griffin preserva o que já foi baixado e tenta retomar automaticamente na próxima abertura. Tente novamente pela tela de separação ou por **Preferências → Processamento**. O modelo é baixado uma vez e não precisa ser instalado em cada faixa.

### A separação está usando CPU

Isso pode ser normal. Em **Preferências → Processamento**, confira **Aceleração** e **Provider ONNX**. `nvidia-smi` sozinho não garante que CUDA/cuDNN estejam disponíveis para o worker. Em uma máquina NVIDIA compatível, use **Instalar suporte NVIDIA** e repita a separação. Se o runtime falhar, o fallback para CPU é esperado.

### A separação falha ou fica sem memória

Feche outros aplicativos pesados, reduza **Threads de processamento**, escolha o perfil **Balanceado** ou **Velocidade** e processe um stem por vez. Verifique se há espaço livre para o modelo e os stems temporários.

### O áudio não toca

Não é necessário ter stems para tocar uma faixa importada. Confirme se o arquivo de origem ainda existe no caminho usado pela biblioteca e se o dispositivo de saída do sistema está disponível. Quando houver stems, confira mute, solo e volume de cada canal; se uma saída individual foi selecionada, volte para **Estéreo**.

### O projeto abriu com faixas ausentes

O `.gfn` guarda referências, não cópias dos áudios. Restaure os arquivos nos caminhos originais ou reimporte-os na biblioteca. O projeto pode continuar sendo usado para revisar pastas e configurações enquanto as faixas são recuperadas.

### O YouTube não importa

Verifique se o `yt-dlp` está instalado e atualizado em **Preferências → Importação do YouTube**. Use um vídeo individual acessível publicamente e autorizado. Playlists, DRM e restrições técnicas não são contornados.

### O microfone não aparece

Conceda permissão de microfone ao Griffin no sistema operacional, conecte o dispositivo antes de abrir o app e reabra a tela do Studio. Se necessário, selecione **Dispositivo padrão** e teste novamente.

### O OBS captura silêncio ou eco

Use **Application Audio Capture (BETA)** no Windows, escolha a janela correta e desative o áudio global do desktop. Confira se o Griffin e o OBS usam a mesma taxa de amostragem.

### Preciso liberar espaço

Use **Preferências → Processamento → Limpar cache**. Isso remove stems recalculáveis, mas preserva os modelos, as faixas originais, os projetos e as preferências. Para liberar ainda mais espaço, desinstale o modelo estendido se essa opção estiver disponível ou use o desinstalador com cuidado; `--purge` apaga os dados locais.

## 13. Privacidade e limites

Não há telemetria, analytics ou servidor próprio do Griffin. Separação, análise, reprodução, mixagem, exportação, projetos e preferências são locais.

As funções que podem acessar a internet são a verificação de atualizações, a preparação de modelos/runtime NVIDIA/`yt-dlp`, a importação por URL ou YouTube e a separação remota opcional. Downloads técnicos incompletos podem ser retomados na abertura seguinte. A separação remota exige uma confirmação explícita antes de cada envio. Consulte a [Política de Privacidade](../PRIVACY.md) e a documentação de [provedores remotos](REMOTE_PROVIDERS.md).

## 14. Desenvolvimento e validação

```bash
npm run typecheck
npm test
npm run build:frontend
npm run validate:tauri
npm run validate:version
cargo test --manifest-path src-tauri/Cargo.toml --no-default-features --features gui
```

Para gerar pacotes:

```bash
npm run package:linux
npm run package:win
npm run validate:packages
```

Os artefatos são gravados em `release/`. O processo de publicação e assinatura está documentado em [RELEASE.md](RELEASE.md).

## 15. Ajuda e contribuições

Para relatar um problema, inclua sistema operacional, versão do Griffin, formato e duração da faixa, provider efetivo (`CPU` ou `CUDA`) e a mensagem exibida pelo aplicativo. Em **Preferências → Sobre**, use **Copiar diagnóstico** e revise o texto antes de anexá-lo; **Abrir logs** ajuda a localizar os arquivos da sessão. Não publique API keys, arquivos de áudio privados ou logs que contenham dados sensíveis.

Abra uma issue no [repositório do Griffin](https://github.com/britors/Griffin) e consulte [CONTRIBUTING.md](../CONTRIBUTING.md) antes de enviar uma contribuição.
