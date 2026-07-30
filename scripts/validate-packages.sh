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

for script in scripts/download-models.sh scripts/install.sh scripts/uninstall.sh; do
  require_file "${script}"
  bash -n "${script}"
  [[ -x "${script}" ]] || fail "script sem permissão de execução: ${script}"
done

require_file PKGBUILD
bash -n PKGBUILD
grep -F "pkgname=griffin-music" PKGBUILD >/dev/null || fail "PKGBUILD sem pkgname esperado"
grep -F "package()" PKGBUILD >/dev/null || fail "PKGBUILD sem função package()"
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
  echo "NSIS Windows x64 validado: ${exe}"
  exit 0
fi

[[ "${mode}" == "linux" ]] || fail "modo inválido: ${mode} (use linux ou windows)"
appimage="$(find "${release_dir}" -maxdepth 1 -type f -iname '*.AppImage' -print -quit)"
deb="$(find "${release_dir}" -maxdepth 1 -type f -iname '*.deb' -print -quit)"
rpm="$(find "${release_dir}" -maxdepth 1 -type f -iname '*.rpm' -print -quit)"
require_file "${appimage}"
require_file "${deb}"
require_file "${rpm}"

file "${appimage}" | grep -F 'ELF 64-bit' >/dev/null || fail "AppImage não é ELF 64-bit: ${appimage}"
file "${deb}" | grep -F 'Debian binary package' >/dev/null || fail "DEB inválido: ${deb}"
file "${rpm}" | grep -F 'RPM' >/dev/null || fail "RPM inválido: ${rpm}"

command -v dpkg-deb >/dev/null || fail "dpkg-deb é obrigatório para validar o DEB"
command -v rpm >/dev/null || fail "rpm é obrigatório para validar o RPM"
deb_listing="$(dpkg-deb --contents "${deb}")"
rpm_listing="$(rpm -qlp "${rpm}")"
for listing in "${deb_listing}" "${rpm_listing}"; do
  require_listing_entry "${listing}" 'resources/icon.png'
  require_listing_entry "${listing}" 'resources/models/htdemucs.onnx'
  for stem in bass drums other vocals; do
    require_listing_entry "${listing}" "resources/models/htdemucs-ft/htdemucs_ft_${stem}_fp16weights.onnx"
  done
done

temp_dir="$(mktemp -d)"
trap 'rm -rf "${temp_dir}"' EXIT
(cd "${temp_dir}" && "${OLDPWD}/${appimage}" --appimage-extract >/dev/null)
require_file "${temp_dir}/squashfs-root/resources/icon.png"
require_file "${temp_dir}/squashfs-root/resources/models/htdemucs.onnx"
for stem in bass drums other vocals; do
  require_file "${temp_dir}/squashfs-root/resources/models/htdemucs-ft/htdemucs_ft_${stem}_fp16weights.onnx"
done
"${appimage}" --appimage-version >/dev/null

echo "AppImage, DEB e RPM validados com logo e modelos ONNX: ${release_dir}"
