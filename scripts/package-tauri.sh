#!/usr/bin/env bash
set -euo pipefail

platform="${1:-linux}"

case "${platform}" in
  linux)
    npx tauri build --bundles appimage,deb,rpm
    bash scripts/collect-tauri-artifacts.sh linux
    ;;
  windows)
    npx tauri build --bundles nsis
    bash scripts/collect-tauri-artifacts.sh windows
    ;;
  *)
    echo "Falha: plataforma inválida: ${platform} (use linux ou windows)" >&2
    exit 1
    ;;
esac
