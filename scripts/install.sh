#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then echo "Execute como root: curl ... | sudo bash" >&2; exit 1; fi
source /etc/os-release
repo="${GRIFFIN_REPO:-britors/Griffin}"
requested_version="${GRIFFIN_VERSION:-latest}"
api_base="https://api.github.com/repos/${repo}"
public_key="${GRIFFIN_UPDATER_PUBLIC_KEY:-dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU5RkY5MTlCOTYzOTA0QTIKUldTaUJEbVdtNUgvV1l6aVUwTFFGeWR5bm0xcXU1V3N5clZpQmRNWm1KekJCbStvcG5lK0pnWlcK}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

command -v minisign >/dev/null || { echo "minisign é obrigatório para verificar o instalador" >&2; exit 1; }

release_json="${tmpdir}/release.json"
if [[ "${requested_version}" == "latest" ]]; then
  curl -fsSL "${api_base}/releases/latest" -o "${release_json}"
  version="$(sed -n 's/.*"tag_name": "\([^"]*\)".*/\1/p' "${release_json}" | head -1)"
else
  version="${requested_version}"
  curl -fsSL "${api_base}/releases/tags/${version}" -o "${release_json}"
fi
[[ -n "${version}" ]] || { echo "não foi possível determinar a versão da release" >&2; exit 1; }
asset_version="${version#v}"

asset_url() {
  local suffix="$1"
  awk -v suffix="${suffix}" '
    /"name":/ {
      name=$0
      sub(/^.*"name": "/, "", name)
      sub(/".*$/, "", name)
      wanted=(name ~ suffix)
    }
    wanted && /"browser_download_url":/ {
      url=$0
      sub(/^.*"browser_download_url": "/, "", url)
      sub(/".*$/, "", url)
      print url
      exit
    }
  ' "${release_json}"
}

download_verified() {
  local suffix="$1"
  local destination="$2"
  local url
  url="$(asset_url "${suffix}")"
  [[ -n "${url}" ]] || { echo "asset não encontrado para ${suffix}" >&2; exit 1; }
  curl -fsSL "${url}" -o "${destination}"
  curl -fsSL "${url}.sig" -o "${destination}.sig"
  minisign -Vm "${destination}" -x "${destination}.sig" -P "${public_key}"
}

case "${ID_LIKE:-$ID}" in
  *fedora*|*rhel*|*suse*)
    download_verified "griffin-music-${asset_version}-.*x86_64\\.rpm$" "${tmpdir}/griffin.rpm"
    if command -v zypper >/dev/null; then zypper --non-interactive install -y "${tmpdir}/griffin.rpm"; else dnf install -y "${tmpdir}/griffin.rpm"; fi
    ;;
  *debian*|*ubuntu*)
    download_verified "_${asset_version}_.*amd64\\.deb$" "${tmpdir}/griffin.deb"
    apt-get install -y "${tmpdir}/griffin.deb"
    ;;
  *) echo "Distribuição não suportada: ${ID}" >&2; exit 1 ;;
esac
