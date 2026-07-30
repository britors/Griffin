#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then echo "Execute como root: curl ... | sudo bash" >&2; exit 1; fi
source /etc/os-release
repo="${GRIFFIN_REPO:-w3ti/griffin-music}"
version="${GRIFFIN_VERSION:-latest}"
if [[ "${version}" == "latest" ]]; then
  version="$(curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" | sed -n 's/.*"tag_name": "\([^"]*\)".*/\1/p' | head -1)"
fi
asset_version="${version#v}"
base="https://github.com/${repo}/releases/download/${version}"
tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

case "${ID_LIKE:-$ID}" in
  *fedora*|*rhel*|*suse*)
    curl -fsSL "${base}/griffin-music-${asset_version}.x86_64.rpm" -o "${tmpdir}/griffin.rpm"
    if command -v zypper >/dev/null; then zypper --non-interactive --allow-unsigned-rpm install -y "${tmpdir}/griffin.rpm"; else dnf install -y --nogpgcheck "${tmpdir}/griffin.rpm"; fi
    ;;
  *debian*|*ubuntu*)
    curl -fsSL "${base}/griffin-music_${asset_version}_amd64.deb" -o "${tmpdir}/griffin.deb"
    apt-get install -y "${tmpdir}/griffin.deb"
    ;;
  *) echo "Distribuição não suportada: ${ID}" >&2; exit 1 ;;
esac
