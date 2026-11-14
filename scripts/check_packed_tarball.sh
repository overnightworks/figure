#!/usr/bin/env bash
# Proves a packed figure tarball runs: installs it without install scripts into a temporary directory and expects `figure check`
# to exit 0 on the test builder's conformant file, 1 on a file that is not GLB and 2 on a missing file; expects `figure check --as clip`
# to exit 0 on each of figure's base clips, written from the keys of the built gestures, and 1 on the conformant figure; expects
# `figure check --as room` to exit 0 on the test builder's conformant room and 1 on the conformant figure; expects the declarations
# of ./draw, and every declaration they reach through relative imports, to name no three type; then removes three and the @pixiv packages (three-vrm and three-vrm-animation) and expects the check, all three of its kinds, and the package's root, ./codes and ./profile to work without them; expects `overnightworks-figure/vocabulary.json` to equal, key for key and in order, the gesture keys of the installed root's `figureGesture`, the values of the installed `dist/expressions.js`' `figureMood` and version 1.
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
node "${repository}/scripts/write_conformant_figure.mjs" --as room "${install_directory}/synthetic-room.glb"
node "${repository}/scripts/write_base_clips.mjs" "${install_directory}/base-clips"
cd "${install_directory}"
printf '{"private":true,"dependencies":{"overnightworks-figure":"file:%s"}}' "${tarball}" > package.json
npm install --ignore-scripts
printf 'plain text' > not-glb.txt
npx figure check synthetic.vrm
status=0; npx figure check not-glb.txt || status=$?
test "${status}" -eq 1
status=0; npx figure check missing.glb || status=$?
test "${status}" -eq 2

for clip in base-clips/*.vrma; do
  npx figure check --as clip "${clip}"
done
status=0; npx figure check --as clip synthetic.vrm || status=$?
test "${status}" -eq 1
npx figure check --as room synthetic-room.glb
status=0; npx figure check --as room synthetic.vrm || status=$?
test "${status}" -eq 1

installed="${install_directory}/node_modules/overnightworks-figure"
test -f "${installed}/dist/draw.js"
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
const dist = join(process.argv[1], "dist");
const pending = ["draw.d.ts"];
const reached = new Set();
while (pending.length > 0) {
  const declaration = pending.pop();
  if (reached.has(declaration)) continue;
  reached.add(declaration);
  const text = readFileSync(join(dist, declaration), "utf8");
  for (const [, specifier] of text.matchAll(/(?:from|import\()\s*["\x27]([^"\x27]+)["\x27]/g)) {
    if (/^(three|@pixiv\/)/.test(specifier)) {
      console.error(`dist/${declaration} names a three type`);
      process.exit(1);
    }
    if (specifier.startsWith(".")) pending.push(resolve("/", declaration, "..", specifier).slice(1).replace(/\.js$/, ".d.ts"));
  }
}
' "${installed}"
rm -rf "${install_directory}/node_modules/three" "${install_directory}/node_modules/@pixiv"
npx figure check synthetic.vrm
for clip in base-clips/*.vrma; do
  npx figure check --as clip "${clip}"
done
npx figure check --as room synthetic-room.glb
node --input-type=module -e "for (const entry of ['', '/codes', '/profile']) await import('overnightworks-figure' + entry)"
node --input-type=module -e "const root = await import('overnightworks-figure'); const profile = await import('overnightworks-figure/profile'); if (typeof root.checkRoom !== 'function' || root.roomProfile === undefined || profile.roomProfile === undefined) process.exit(1)"
node --input-type=module -e '
import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const { figureGesture } = await import("overnightworks-figure");
const { figureMood } = await import(pathToFileURL(join(process.argv[1], "dist", "expressions.js")).href);
const { default: vocabulary } = await import("overnightworks-figure/vocabulary.json", { with: { type: "json" } });
const expected = { version: 1, gestures: Object.keys(figureGesture), moods: Object.values(figureMood) };
if (!isDeepStrictEqual(vocabulary, expected)) {
  const differing = [...new Set([...Object.keys(vocabulary), ...Object.keys(expected)])].filter((key) => !isDeepStrictEqual(vocabulary[key], expected[key]));
  console.error("vocabulary.json disagrees with the installed figureGesture and figureMood in:", differing.join(", "), JSON.stringify(vocabulary), JSON.stringify(expected));
  process.exit(1);
}
' "${installed}"
