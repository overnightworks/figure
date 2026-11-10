#!/usr/bin/env bash
# Proves a packed figure tarball runs: installs it into a temporary directory and expects `figure check` to exit 0 on the
# test builder's conformant file, 1 on a file that is not GLB and 2 on a missing file.
# Usage: scripts/check_packed_tarball.sh <tarball>; run it from the repository after `pnpm run build`.
# Exit codes: 2 for a missing tarball argument, non-zero for any failed expectation or command.
set -euo pipefail

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  echo "usage: scripts/check_packed_tarball.sh <tarball>" >&2
  exit 2
fi

tarball="$(realpath "$1")"
repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install_directory="$(mktemp -d)"
trap 'rm -rf "${install_directory}"' EXIT

node "${repository}/scripts/write_conformant_figure.mjs" "${install_directory}/synthetic.vrm"
cd "${install_directory}"
printf '{"private":true,"dependencies":{"overnightworks-figure":"file:%s"}}' "${tarball}" > package.json
npm install
printf 'plain text' > not-glb.txt
npx figure check synthetic.vrm
status=0; npx figure check not-glb.txt || status=$?
test "${status}" -eq 1
status=0; npx figure check missing.glb || status=$?
test "${status}" -eq 2
