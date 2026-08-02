#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "Falha: $*" >&2
  exit 1
}

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
  if command -v rg >/dev/null; then
    forbidden_found=0
    rg -n -i --glob 'package.json' --glob 'src/**' --glob 'scripts/**' --glob 'packaging/**' \
      --glob 'src-tauri/**' --glob 'vite.config.ts' --glob 'tsconfig.json' \
      --glob '!scripts/validate-tauri.sh' "${forbidden}" . >/dev/null || forbidden_found=$?
  else
    forbidden_found=0
    grep -R -n -i -I --exclude-dir=node_modules --exclude-dir=target --exclude='validate-tauri.sh' \
      "${forbidden}" package.json src scripts packaging src-tauri vite.config.ts tsconfig.json >/dev/null 2>&1 || forbidden_found=$?
  fi
  if [[ "${forbidden_found}" -eq 0 ]]; then
    fail "referência ativa proibida encontrada: ${forbidden}"
  fi
done

grep -E -n 'tauri dev|tauri build' package.json >/dev/null || fail "scripts Tauri ausentes no package.json"
grep -E -n 'griffin-onnx-worker' src-tauri/tauri.conf.json src-tauri/src/lib.rs >/dev/null \
  || fail "worker ONNX não está integrado ao app Tauri"
grep -E -n 'Command::new|griffin-onnx-worker' src-tauri/src/commands.rs >/dev/null \
  || fail "separação não inicia o worker nativo separado"

echo "Fronteira Tauri validada: nenhum runtime Electron e worker ONNX separado."
