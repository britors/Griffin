# Validação manual do Griffin Music

## Separação local

1. Inicie com `npm run dev`.
2. Importe uma faixa que você tenha autorização para usar em WAV, MP3 e FLAC.
3. Selecione a faixa e execute a separação.
4. Confirme os quatro stems: vocal, bateria, baixo e outros.
5. Reabra a mesma faixa e confirme que o cache evita uma nova inferência.

## Player

- Reproduza por alguns minutos e confirme que os stems permanecem sincronizados.
- Teste pitch sem alterar a duração percebida.
- Teste tempo sem alterar a tonalidade.
- Teste mute, solo, volume e loop A-B.

## Evidência

Para uma validação reproduzível automatizada, execute:

```bash
npm run typecheck
npm test
npm run build
```

O teste de integração gera uma entrada WAV local, executa a separação ONNX e executa uma segunda leitura para verificar o cache. Os modelos especialistas devem estar presentes em `src/main/models/htdemucs-ft/`; sem eles, o teste é pulado.
