#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_triple="$(rustc -vV | sed -n 's/^host: //p')"
cargo build --manifest-path "${root_dir}/src-tauri/Cargo.toml" --release --bin griffin-onnx-worker --no-default-features
mkdir -p "${root_dir}/src-tauri/binaries"
worker_name="griffin-onnx-worker"
if [[ "${target_triple}" == *windows* ]]; then worker_name="${worker_name}.exe"; fi
cp "${root_dir}/src-tauri/target/release/${worker_name}" "${root_dir}/src-tauri/binaries/${worker_name}-${target_triple}"
