# Release 0.1.0

O workflow de release é disparado por tags `v*` e publica AppImage, `.deb`, `.rpm` e instalador NSIS x64. Os modelos `htdemucs_ft` e o fallback `htdemucs` são baixados no runner antes do empacotamento e incluídos em `extraResources/models`.

Validação local:

```bash
npm run typecheck
npm run build
bash scripts/download-models.sh
npm run package:linux
```

O teste do instalador Windows deve ser executado em runner Windows ou máquina Windows 10/11 x64.
