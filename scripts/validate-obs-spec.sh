#!/usr/bin/env bash
set -euo pipefail

spec="${1:-packaging/griffin.spec}"
rpm_file="${2:-}"
version="${GRIFFIN_VERSION:-$(node -p "require('./package.json').version")}"

fail() { echo "Falha: $*" >&2; exit 1; }
require_file() { [[ -s "$1" ]] || fail "arquivo ausente ou vazio: $1"; }
require_file "$spec"
command -v rpmspec >/dev/null || fail "rpmspec é obrigatório para validar o spec do OBS"
rpmspec --parse "$spec" >/dev/null || fail "spec inválido: $spec"
grep -E '^Name:[[:space:]]+griffin-music$' "$spec" >/dev/null || fail "spec sem Name griffin-music"
grep -E "^Version:[[:space:]]+${version//./\.}$" "$spec" >/dev/null || fail "versão do spec não corresponde a ${version}"
grep -F '%{_bindir}/griffin-music' "$spec" >/dev/null || fail 'binário principal não coberto por %files'
grep -F '%{_bindir}/griffin-onnx-worker' "$spec" >/dev/null || fail 'worker ONNX não coberto por %files'
grep -F 'com.w3ti.griffinmusic.desktop' "$spec" >/dev/null || fail 'desktop entry não coberto pelo spec'
grep -F 'griffin-music.png' "$spec" >/dev/null || fail 'ícone griffin-music não coberto pelo spec'
grep -F 'libonnxruntime_providers_*.so' "$spec" >/dev/null || fail 'providers ONNX opcionais não cobertos por %files'

if [[ -n "$rpm_file" ]]; then
  require_file "$rpm_file"
  command -v rpm >/dev/null || fail "rpm é obrigatório para validar o artefato"
  rpm_version="$(rpm -qp --queryformat '%{VERSION}' "$rpm_file")"
  [[ "$rpm_version" == "$version" ]] || fail "RPM usa versão ${rpm_version}; esperado ${version}"
  listing="$(rpm -qlp "$rpm_file")"
  for entry in \
    /usr/bin/griffin-music \
    /usr/bin/griffin-onnx-worker \
    /usr/share/applications/com.w3ti.griffinmusic.desktop \
    /usr/share/icons/hicolor/32x32/apps/griffin-music.png \
    /usr/share/icons/hicolor/128x128/apps/griffin-music.png \
    /usr/share/icons/hicolor/256x256/apps/griffin-music.png; do
    grep -Fx "$entry" <<<"$listing" >/dev/null || fail "arquivo ausente no RPM: $entry"
  done
  while IFS= read -r provider; do
    grep -F "$(basename "$provider")" "$spec" >/dev/null || fail "provider do RPM não coberto pelo spec: $provider"
  done < <(grep '/usr/bin/libonnxruntime_providers_' <<<"$listing")
fi

echo "Spec OBS validado: $spec${rpm_file:+ contra $rpm_file}"
