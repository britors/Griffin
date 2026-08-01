#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${GRIFFIN_VERSION:-0.1.3}"
bundle_dir="${root_dir}/src-tauri/target/release/bundle/rpm"
rpm_top="$(mktemp -d /tmp/griffin-rpm.XXXXXX)"
trap 'rm -rf "${rpm_top}"' EXIT

mkdir -p "${rpm_top}"/{BUILD,RPMS,SOURCES,SPECS,SRPMS,tmp}
mkdir -p "${bundle_dir}"
find "${bundle_dir}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp "${root_dir}/packaging/griffin-release.spec" "${rpm_top}/SPECS/griffin-release.spec"
rpmbuild -bb "${rpm_top}/SPECS/griffin-release.spec" \
  --define "_topdir ${rpm_top}" \
  --define "_griffin_root ${root_dir}" \
  --define "version ${version}" \
  --define "_tmppath ${rpm_top}/tmp" \
  --define "_rpmdir ${bundle_dir}"

rpm_file="$(find "${bundle_dir}" -mindepth 2 -maxdepth 2 -type f -name "griffin-music-${version}-*.rpm" -print -quit)"
test -n "${rpm_file}"
cp "${rpm_file}" "${bundle_dir}/"
find "${bundle_dir}" -maxdepth 1 -type f -name '*.rpm' -print
