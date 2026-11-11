#!/usr/bin/env bash
# Proves a packed figure tarball runs: installs it without install scripts into a temporary directory and expects `figure check`
# to exit 0 on the test builder's conformant file, 1 on a file that is not GLB and 2 on a missing file; expects the declarations
# of ./draw to name no three type; then removes three and three-vrm and expects the package's root, ./codes and ./profile to load without them.
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
npm install --ignore-scripts
printf 'plain text' > not-glb.txt
npx figure check synthetic.vrm
status=0; npx figure check not-glb.txt || status=$?
test "${status}" -eq 1
status=0; npx figure check missing.glb || status=$?
test "${status}" -eq 2

installed="${install_directory}/node_modules/overnightworks-figure"
test -f "${installed}/dist/draw.js"
if grep -rqE "from ['\"](three|@pixiv)" "${installed}/dist/draw.d.ts"; then
  echo "dist/draw.d.ts names a three type" >&2
  exit 1
fi
rm -rf "${install_directory}/node_modules/three" "${install_directory}/node_modules/@pixiv"
npx figure check synthetic.vrm
node --input-type=module -e "for (const entry of ['', '/codes', '/profile']) await import('overnightworks-figure' + entry)"
