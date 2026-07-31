#!/usr/bin/env bash
set -euo pipefail

platform="${1:-linux}"
release_dir="release"
bundle_dir="src-tauri/target/release/bundle"

fail() {
  echo "Falha: $*" >&2
  exit 1
}

[[ -d "${bundle_dir}" ]] || fail "diretório de bundles não encontrado: ${bundle_dir}"
mkdir -p "${release_dir}"

copy_files() {
  local search_dir="$1"
  local pattern="$2"
  local -a files=()
  while IFS= read -r -d '' file; do
    files+=("${file}")
  done < <(find "${search_dir}" -maxdepth 1 -type f -iname "${pattern}" -print0)
  ((${#files[@]} > 0)) || fail "nenhum artefato ${pattern} encontrado em ${search_dir}"
  cp "${files[@]}" "${release_dir}/"
}

case "${platform}" in
  linux)
    copy_files "${bundle_dir}/appimage" '*.AppImage'
    copy_files "${bundle_dir}/deb" '*.deb'
    copy_files "${bundle_dir}/rpm" '*.rpm'
    ;;
  windows)
    copy_files "${bundle_dir}/nsis" '*.exe'
    ;;
  *)
    fail "plataforma inválida: ${platform} (use linux ou windows)"
    ;;
esac

echo "Artefatos Tauri coletados em ${release_dir}/:"
find "${release_dir}" -maxdepth 1 -type f -printf '  %f\n' | sort
