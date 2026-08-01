#!/usr/bin/env bash
set -euo pipefail

platform="${1:-linux}"
release_dir="release"
bundle_dir="src-tauri/target/release/bundle"
version="${GRIFFIN_VERSION:-$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([0-9][^"]*\)".*/\1/p' package.json | head -1)}"

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
    [[ -n "${version}" ]] || fail "versão da aplicação não encontrada"
    rm -f "${release_dir}"/*.deb "${release_dir}"/*.rpm
    copy_files "${bundle_dir}/deb" "*_${version}_*.deb"
    copy_files "${bundle_dir}/rpm" "*-${version}-*.rpm"
    ;;
  windows)
    [[ -n "${version}" ]] || fail "versão da aplicação não encontrada"
    rm -f "${release_dir}"/*.exe
    copy_files "${bundle_dir}/nsis" "*${version}*.exe"
    ;;
  *)
    fail "plataforma inválida: ${platform} (use linux ou windows)"
    ;;
esac

echo "Artefatos Tauri coletados em ${release_dir}/:"
find "${release_dir}" -maxdepth 1 -type f -printf '  %f\n' | sort
