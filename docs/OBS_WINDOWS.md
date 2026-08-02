# Griffin Music com OBS Studio no Windows

O Griffin não precisa de cabo virtual para o fluxo normal de transmissão. O player envia o áudio para a saída padrão do Windows, e o OBS pode capturar somente o áudio do processo Griffin.

## Configuração recomendada

1. Instale e abra o Griffin Music.
2. No OBS Studio, crie uma fonte **Application Audio Capture (BETA)**.
3. Selecione a janela do Griffin Music.
4. Em prioridade de correspondência, prefira o executável quando o título da janela mudar.
5. Para capturar a interface, adicione também uma fonte **Window Capture** do Griffin.
6. No OBS, desative o áudio global do desktop se estiver usando a fonte de áudio por aplicativo, evitando eco.
7. No Griffin, use 48 kHz quando o restante do projeto OBS estiver configurado para 48 kHz.

O OBS Studio oferece captura por aplicativo no Windows 10 versão 2004 ou posterior e no Windows 11. Em versões recentes, o áudio também pode ser incluído diretamente em Window Capture. Consulte o [guia oficial de captura de áudio por aplicativo](https://obsproject.com/kb/application-audio-capture-guide).

## Checklist de teste

- O medidor do OBS reage ao iniciar o player do Griffin.
- Pausar o Griffin silencia o medidor sem afetar o microfone.
- Mute, solo, volume, pan, pitch e tempo chegam ao OBS já processados.
- O microfone aparece somente na fonte configurada, sem duplicação.
- Não há eco quando o áudio global do desktop está desativado.
- Trocar de faixa não cria uma segunda fonte nem aumenta continuamente o uso de RAM.
- O áudio continua sincronizado com a captura da janela.

## Compatibilidade alternativa

Se a captura por aplicativo não listar o Griffin ou não capturar seu áudio, use uma saída virtual do Windows/driver de áudio e adicione essa saída como **Audio Input Capture** no OBS. Esse é um fallback de compatibilidade; não é necessário no fluxo padrão.

## Escopo atual

O Griffin ainda não controla cenas, gravação ou transmissão via OBS WebSocket. A integração atual é deliberadamente baseada na captura nativa do Windows, com menos dependências e menor risco de duplicar buffers de áudio.
