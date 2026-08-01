# Release 0.1.2

O workflow de release é disparado por tags `v*` e publica `.deb`, `.rpm` e instalador NSIS x64. Os modelos ONNX não são mais empacotados no instalador: o próprio aplicativo os baixa sob demanda em runtime (`userData/models`), na primeira execução ou via Preferências.

O empacotamento é feito pelo Tauri: o instalador Windows usa NSIS e as distribuições Linux geram `.deb` e `.rpm`. Após o build, os artefatos são coletados em `release/` para validação e publicação. Atualizações automáticas embutidas ainda estão desativadas; no Linux, o RPM/OBS continua sendo atualizado pelo gerenciador de pacotes (`zypper`).

Validação local:

```bash
npm run typecheck
npm run build
npm run package:linux
npm run validate:packages
```

O teste do instalador Windows deve ser executado em runner Windows ou máquina Windows 10/11 x64. O yt-dlp é baixado pelo próprio Griffin em runtime e armazenado por usuário.
