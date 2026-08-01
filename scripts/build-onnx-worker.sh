#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_triple="$(rustc -vV | sed -n 's/^host: //p')"
cargo build --manifest-path "${root_dir}/src-tauri/Cargo.toml" --release --bin griffin-onnx-worker --no-default-features
mkdir -p "${root_dir}/src-tauri/binaries"
worker_name="griffin-onnx-worker"
worker_binary="${worker_name}"
worker_artifact="${worker_name}-${target_triple}"
if [[ "${target_triple}" == *windows* ]]; then
  worker_binary="${worker_binary}.exe"
  worker_artifact="${worker_artifact}.exe"
fi
cp "${root_dir}/src-tauri/target/release/${worker_binary}" "${root_dir}/src-tauri/binaries/${worker_artifact}"

# ONNX Runtime loads non-CPU execution providers as shared libraries at
# runtime. Keep the provider libraries next to the external worker so Tauri
# can include them in the application resources.
case "${target_triple}" in
  *linux*)
    provider_names=(
      libonnxruntime_providers_cuda.so
      libonnxruntime_providers_shared.so
    )
    ;;
  *windows*)
    provider_names=(
      onnxruntime_providers_cuda.dll
      onnxruntime_providers_shared.dll
    )
    ;;
  *)
    provider_names=()
    ;;
esac

for provider_name in "${provider_names[@]}"; do
  provider_path="${root_dir}/src-tauri/target/release/${provider_name}"
  [[ -s "${provider_path}" ]] || {
    echo "Falha: provider ONNX obrigatório não encontrado: ${provider_path}" >&2
    exit 1
  }
  cp "${provider_path}" "${root_dir}/src-tauri/binaries/${provider_name}"
  cp "${provider_path}" "${root_dir}/src-tauri/binaries/${provider_name}-${target_triple}"
done
