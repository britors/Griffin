# Validação manual do Griffin Music

## Separação local

1. Inicie com `npm run dev`.
2. Importe uma faixa que você tenha autorização para usar em WAV, MP3 e FLAC.
3. Selecione a faixa e execute a separação.
4. Confirme os quatro stems: vocal, bateria, baixo e outros. Se o modelo de seis stems estiver instalado, confirme também guitarra e piano.
5. Reabra a mesma faixa e confirme que o cache evita uma nova inferência.

## Player

- Reproduza por alguns minutos e confirme que os stems permanecem sincronizados.
- Teste pitch sem alterar a duração percebida.
- Teste tempo sem alterar a tonalidade.
- Teste mute, solo, volume e loop A-B.

## Windows + OBS Studio

1. Instale o NSIS em Windows 10/11 e abra o Griffin Music.
2. No OBS, adicione `Application Audio Capture (BETA)` apontando para o Griffin.
3. Confirme que o medidor acompanha o player e que pausar o Griffin silencia somente essa fonte.
4. Desative o áudio global do desktop no OBS para evitar eco.
5. Teste uma faixa de quatro stems e uma de seis stems, incluindo mute, solo, pitch e tempo.
6. Deixe o player ativo por pelo menos 15 minutos e confirme que o uso de RAM estabiliza.

O roteiro detalhado está em [OBS no Windows](OBS_WINDOWS.md).

## Evidência

Para uma validação reproduzível automatizada, execute:

```bash
npm run validate:tauri
npm run typecheck
npm test
npm run build
```

O worker ONNX nativo recebe uma entrada WAV, executa a separação em processo separado e reutiliza o cache quando a mesma fonte é processada novamente. Os modelos são armazenados na pasta de dados do Griffin; o modelo estendido `htdemucs_6s.onnx` habilita guitarra e piano.
