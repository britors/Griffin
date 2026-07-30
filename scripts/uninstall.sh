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
  target_user="${SUDO_USER:-${USER}}"
  target_home="$(getent passwd "${target_user}" | cut -d: -f6)"
  if [[ -n "${target_home}" && "${target_home}" != "/" ]]; then
    rm -rf "${target_home}/.config/GriffinMusic"
    echo "Dados locais removidos para ${target_user}."
  else
    echo "Não foi possível determinar o diretório do usuário; dados preservados." >&2
  fi
else
  echo "Dados do usuário foram preservados. Use --purge para removê-los."
fi
