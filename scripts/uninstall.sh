#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then echo "Execute como root." >&2; exit 1; fi
source /etc/os-release
purge="${1:-}"
case "${ID_LIKE:-$ID}" in
  *fedora*|*rhel*|*suse*) if command -v zypper >/dev/null; then zypper remove -y griffin-music; else dnf remove -y griffin-music; fi ;;
  *debian*|*ubuntu*) apt-get remove -y griffin-music ;;
  *) echo "Distribuição não suportada: ${ID}" >&2; exit 1 ;;
esac
if [[ "${purge}" == "--purge" ]]; then
  rm -rf "/root/.config/GriffinMusic"
  echo "Dados locais removidos para o usuário root."
else
  echo "Dados do usuário foram preservados. Use --purge para removê-los."
fi
