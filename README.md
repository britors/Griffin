# Griffin Music

Aplicativo desktop standalone da W3TI para separação local de stems e prática instrumental.

## Desenvolvimento

```bash
npm install
npm run dev
```

O app usa por padrão o conjunto `htdemucs_ft` de melhor qualidade, com quatro arquivos especialistas em `src/main/models/htdemucs-ft/`. O fallback single-file `src/main/models/htdemucs.onnx` também é reconhecido.

Modelos ONNX recomendados:

```bash
mkdir -p src/main/models/htdemucs-ft
curl -L -o src/main/models/htdemucs-ft/htdemucs_ft_drums_fp16weights.onnx https://huggingface.co/StemSplitio/htdemucs-ft-drums-onnx/resolve/main/htdemucs_ft_drums_fp16weights.onnx
curl -L -o src/main/models/htdemucs-ft/htdemucs_ft_bass_fp16weights.onnx https://huggingface.co/StemSplitio/htdemucs-ft-bass-onnx/resolve/main/htdemucs_ft_bass_fp16weights.onnx
curl -L -o src/main/models/htdemucs-ft/htdemucs_ft_other_fp16weights.onnx https://huggingface.co/StemSplitio/htdemucs-ft-other-onnx/resolve/main/htdemucs_ft_other_fp16weights.onnx
curl -L -o src/main/models/htdemucs-ft/htdemucs_ft_vocals_fp16weights.onnx https://huggingface.co/StemSplitio/htdemucs-ft-vocals-onnx/resolve/main/htdemucs_ft_vocals_fp16weights.onnx
```

O adapter lê o áudio local, converte para estéreo/44,1 kHz, processa segmentos sobrepostos e grava quatro WAVs PCM no cache.

## Build

```bash
npm run typecheck
npm run build
npm run package:linux
```

O empacotamento gera AppImage, `.deb` e `.rpm` no Linux, e NSIS `.exe` no Windows.

## Arquitetura

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para a divisão entre domínio, casos de uso, portas, adapters e IPC.
