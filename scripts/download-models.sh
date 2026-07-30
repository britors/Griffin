#!/usr/bin/env bash
set -euo pipefail

model_dir="${GRIFFIN_MODEL_DIR:-src/main/models}"
base_url="https://huggingface.co/StemSplitio"
mkdir -p "${model_dir}/htdemucs-ft"

download() {
  local target="$1" url="$2"
  if [[ -s "${target}" ]]; then echo "Modelo já existe: ${target}"; return; fi
  echo "Baixando ${target}..."
  curl --fail --location --retry 3 --retry-delay 2 "${url}" -o "${target}"
  [[ -s "${target}" ]] || { echo "Download vazio: ${target}" >&2; exit 1; }
}

download "${model_dir}/htdemucs.onnx" "${base_url}/htdemucs-onnx/resolve/main/htdemucs_fp16weights.onnx"
for stem in drums bass other vocals; do
  download "${model_dir}/htdemucs-ft/htdemucs_ft_${stem}_fp16weights.onnx" "${base_url}/htdemucs-ft-${stem}-onnx/resolve/main/htdemucs_ft_${stem}_fp16weights.onnx"
done

if [[ "${GRIFFIN_EXTENDED:-0}" == "1" ]]; then
  download "${model_dir}/htdemucs_6s.onnx" "${base_url}/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx"
  echo "Perfil estendido habilitado: guitarra e piano também estarão disponíveis."
else
  echo "Perfil estendido não baixado. Use GRIFFIN_EXTENDED=1 para instalar htdemucs-6s."
fi
echo "Modelos ONNX disponíveis em ${model_dir}."
