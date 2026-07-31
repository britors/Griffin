#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "Falha: $*" >&2
  exit 1
}

command -v rg >/dev/null || fail "rg é obrigatório para validar a fronteira Tauri"

for required_file in \
  package.json \
  src-tauri/Cargo.toml \
  src-tauri/tauri.conf.json \
  src-tauri/src/main.rs \
  src-tauri/src/lib.rs \
  src-tauri/src/bin/griffin-onnx-worker.rs \
  scripts/build-onnx-worker.sh \
  scripts/collect-tauri-artifacts.sh \
  scripts/package-tauri.sh; do
  [[ -s "${required_file}" ]] || fail "arquivo obrigatório ausente ou vazio: ${required_file}"
done

for forbidden in electron electron-vite electron-builder electron-updater onnxruntime-node; do
  if rg -n -i --glob 'package.json' --glob 'src/**' --glob 'scripts/**' --glob 'packaging/**' \
    --glob 'src-tauri/**' --glob 'vite.config.ts' --glob 'tsconfig.json' \
    --glob '!scripts/validate-tauri.sh' "${forbidden}" . >/dev/null; then
    fail "referência ativa proibida encontrada: ${forbidden}"
  fi
done

rg -n 'tauri dev|tauri build' package.json >/dev/null || fail "scripts Tauri ausentes no package.json"
rg -n 'griffin-onnx-worker' src-tauri/tauri.conf.json src-tauri/src/lib.rs >/dev/null \
  || fail "worker ONNX não está integrado ao app Tauri"
rg -n 'Command::new|griffin-onnx-worker' src-tauri/src/commands.rs >/dev/null \
  || fail "separação não inicia o worker nativo separado"

echo "Fronteira Tauri validada: nenhum runtime Electron e worker ONNX separado."
