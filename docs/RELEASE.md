# Release 0.1.1

O workflow de release é disparado por tags `v*` e publica AppImage, `.deb`, `.rpm` e instalador NSIS x64. Os modelos ONNX não são mais empacotados no instalador: o próprio aplicativo os baixa sob demanda em runtime (`userData/models`), na primeira execução ou via Preferências.

Validação local:

```bash
npm run typecheck
npm run build
npm run package:linux
```

O teste do instalador Windows deve ser executado em runner Windows ou máquina Windows 10/11 x64.
