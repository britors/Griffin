#!/usr/bin/env bash
set -euo pipefail

model_dir="${GRIFFIN_MODEL_DIR:-src-tauri/models}"
base_url="https://huggingface.co/StemSplitio"
mkdir -p "${model_dir}/htdemucs-ft"

download() {
  local target="$1" url="$2" expected_hash="$3"
  if [[ -s "${target}" ]] && [[ "$(sha256sum "${target}" | awk '{print $1}')" == "${expected_hash}" ]]; then
    echo "Modelo já existe: ${target}"
    return
  fi
  rm -f "${target}"
  echo "Baixando ${target}..."
  curl --fail --location --retry 3 --retry-delay 2 "${url}" -o "${target}"
  [[ -s "${target}" ]] || { echo "Download vazio: ${target}" >&2; exit 1; }
  [[ "$(sha256sum "${target}" | awk '{print $1}')" == "${expected_hash}" ]] || { echo "Checksum inválido: ${target}" >&2; rm -f "${target}"; exit 1; }
}

download "${model_dir}/htdemucs.onnx" "${base_url}/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx" d05c269d0178d2a72ad484b10b11dd370193fc923201c3b27a99f848745db70a
for stem in drums bass other vocals; do
  case "${stem}" in
    bass) hash=b533037176b14b2df31c92a5d5b3d5660d0811b9b360d3db761964768b079961 ;;
    drums) hash=047764dff888cfb87da917013377d4ec7a134f7419cbe486d9c339aa17975ddd ;;
    other) hash=b739171a7057b3107bb0711c6222d4a619b41b13a8f04026431d30f32ad2bd71 ;;
    vocals) hash=0cbe651f535415c9d26a7bb614f7d322dd5a080fa0298f2e50f478030a994dce ;;
  esac
  download "${model_dir}/htdemucs-ft/htdemucs_ft_${stem}_fp16weights.onnx" "${base_url}/htdemucs-ft-${stem}-onnx/resolve/main/htdemucs_ft_${stem}_fp16weights.onnx" "${hash}"
done

if [[ "${GRIFFIN_EXTENDED:-0}" == "1" ]]; then
  download "${model_dir}/htdemucs_6s.onnx" "${base_url}/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx" 7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869
  echo "Perfil estendido habilitado: guitarra e piano também estarão disponíveis."
else
  echo "Perfil estendido não baixado. Use GRIFFIN_EXTENDED=1 para instalar htdemucs-6s."
fi
echo "Modelos ONNX disponíveis em ${model_dir}."
