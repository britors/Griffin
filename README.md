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
bash scripts/download-models.sh
```

O adapter lê o áudio local, converte para estéreo/44,1 kHz, processa segmentos sobrepostos e grava quatro WAVs PCM no cache.

## Build

```bash
npm run typecheck
npm run build
npm run package:linux
```

O empacotamento gera AppImage, `.deb` e `.rpm` no Linux, e NSIS `.exe` no Windows.

Para publicar, crie uma tag `v*`; o GitHub Actions baixa os modelos, gera os artefatos Linux/Windows e publica a release automaticamente. O repositório oficial é [britors/Griffin](https://github.com/britors/Griffin).

## Arquitetura

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para a divisão entre domínio, casos de uso, portas, adapters e IPC.
