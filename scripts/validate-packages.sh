#!/usr/bin/env bash
set -euo pipefail

release_dir="${1:-release}"
mode="${2:-linux}"

fail() {
  echo "Falha: $*" >&2
  exit 1
}

require_file() {
  [[ -s "$1" ]] || fail "arquivo ausente ou vazio: $1"
}

require_listing_entry() {
  local listing="$1"
  local entry="$2"
  grep -F -- "$entry" <<<"$listing" >/dev/null || fail "conteúdo não encontrado no pacote: $entry"
}

[[ -d "${release_dir}" ]] || fail "diretório de release não encontrado: ${release_dir}"
for command_name in bash file grep; do
  command -v "${command_name}" >/dev/null || fail "comando obrigatório não encontrado: ${command_name}"
done

for script in scripts/download-models.sh scripts/install.sh scripts/uninstall.sh scripts/package-rpm.sh; do
  require_file "${script}"
  bash -n "${script}"
  [[ -x "${script}" ]] || fail "script sem permissão de execução: ${script}"
done

require_file PKGBUILD
bash -n PKGBUILD
grep -F "pkgname=griffin-music" PKGBUILD >/dev/null || fail "PKGBUILD sem pkgname esperado"
grep -F "package()" PKGBUILD >/dev/null || fail "PKGBUILD sem função package()"

if command -v rpmspec >/dev/null; then
  require_file packaging/griffin.spec
  rpmspec --parse packaging/griffin.spec >/dev/null || fail "griffin.spec inválido"
  grep -E '^Name:[[:space:]]+griffin-music$' packaging/griffin.spec >/dev/null || fail "griffin.spec sem identidade esperada"
  grep -F 'Obsoletes:      griffin < ' packaging/griffin.spec >/dev/null || fail "griffin.spec sem migração do pacote antigo griffin"
  echo "Spec RPM validado por rpmspec."
else
  echo "rpmspec não disponível; spec RPM não validado."
fi

if command -v makepkg >/dev/null; then
  srcinfo="$(mktemp)"
  trap 'rm -f "${srcinfo}"' EXIT
  makepkg --printsrcinfo >"${srcinfo}"
  grep -F "pkgname = griffin-music" "${srcinfo}" >/dev/null || fail "makepkg não reconheceu griffin-music"
  echo "PKGBUILD validado por makepkg."
else
  echo "makepkg não disponível; PKGBUILD validado sintaticamente."
fi

if [[ "${mode}" == "windows" ]]; then
  exe="$(find "${release_dir}" -maxdepth 1 -type f -iname '*.exe' -print -quit)"
  require_file "${exe}"
  file "${exe}" | grep -E 'PE32\+|MS Windows' >/dev/null || fail "instalador não parece ser um executável Windows x64: ${exe}"
  require_file src-tauri/binaries/griffin-onnx-worker-x86_64-pc-windows-msvc.exe
  require_file src-tauri/binaries/onnxruntime_providers_cuda.dll
  require_file src-tauri/binaries/onnxruntime_providers_shared.dll
  echo "NSIS Windows x64 validado: ${exe}"
  exit 0
fi

[[ "${mode}" == "linux" ]] || fail "modo inválido: ${mode} (use linux ou windows)"
deb="$(find "${release_dir}" -maxdepth 1 -type f -iname '*.deb' -print -quit)"
rpm="$(find "${release_dir}" -maxdepth 1 -type f -iname '*.rpm' -print -quit)"
require_file "${deb}"
require_file "${rpm}"

file "${deb}" | grep -F 'Debian binary package' >/dev/null || fail "DEB inválido: ${deb}"
file "${rpm}" | grep -F 'RPM' >/dev/null || fail "RPM inválido: ${rpm}"

command -v dpkg-deb >/dev/null || fail "dpkg-deb é obrigatório para validar o DEB"
command -v rpm >/dev/null || fail "rpm é obrigatório para validar o RPM"

selected_deb=""
while IFS= read -r candidate; do
  if dpkg-deb --contents "${candidate}" | grep -F 'libonnxruntime_providers_cuda' >/dev/null; then
    selected_deb="${candidate}"
    break
  fi
done < <(find "${release_dir}" -maxdepth 1 -type f -iname '*.deb' -print)
selected_rpm=""
while IFS= read -r candidate; do
  if rpm -qlp "${candidate}" | grep -F 'libonnxruntime_providers_cuda' >/dev/null; then
    selected_rpm="${candidate}"
    break
  fi
done < <(find "${release_dir}" -maxdepth 1 -type f -iname '*.rpm' -print)
require_file "${selected_deb}"
require_file "${selected_rpm}"
deb="${selected_deb}"
rpm="${selected_rpm}"
deb_listing="$(dpkg-deb --contents "${deb}")"
rpm_listing="$(rpm -qlp "${rpm}")"
for listing in "${deb_listing}" "${rpm_listing}"; do
  require_listing_entry "${listing}" 'hicolor/256x256/apps/griffin-music.png'
  require_listing_entry "${listing}" 'libonnxruntime_providers_cuda'
done

echo "DEB e RPM validados com logo: ${release_dir}"
