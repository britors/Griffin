# Release 0.1.2

O workflow de release é disparado por tags `v*` e publica AppImage, `.deb`, `.rpm` e instalador NSIS x64. Os modelos ONNX não são mais empacotados no instalador: o próprio aplicativo os baixa sob demanda em runtime (`userData/models`), na primeira execução ou via Preferências.

O instalador NSIS também publica `latest.yml` e usa o GitHub Releases como fonte do `electron-updater`. No Windows, o Griffin verifica atualizações em segundo plano e permite baixá-las e reiniciar para instalar. No Linux, o RPM/OBS continua sendo atualizado pelo gerenciador de pacotes (`zypper`); o auto-updater do Electron não substitui pacotes do sistema.

Validação local:

```bash
npm run typecheck
npm run build
npm run package:linux
```

O teste do instalador Windows deve ser executado em runner Windows ou máquina Windows 10/11 x64.
