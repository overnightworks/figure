# figure

## Commands

- `pnpm run` lists the package scripts. figure has no other task runner.
- `pnpm install --frozen-lockfile`: installs the dependencies; every command below needs it.
- `pnpm run check`: the type check of the sources and the tests.
- `pnpm run build`: emits `dist/`; the process-driven tests in `src/bin.test.ts` run it, so build first.
- `pnpm exec vitest run <file>`: one test file. Add `--coverage` for the lcov report.
- `scripts/check_packed_tarball.sh <tarball>`: installs a packed tarball into a temporary directory and runs `figure check` from it; CI and the release build both call it.
- `scripts/run_consumer_check.sh`: the browser layer (`pnpm run test:consumer`) under the fleet's probe-stack lock, for local use; needs `pnpm exec playwright install chromium` once. CI calls `pnpm run test:consumer` directly. Never run it in watch or UI mode or beside another browser proof.
- Release: the operator dispatches `.github/workflows/release.yml` with the version, which must equal `package.json`'s. An agent dispatches it only on his yes for that one version (quality's `docs/release.md`).
- `quality check`: the shared static check. Run it at the release `.github/workflows/ci.yml` pins, after `git add` (it reads the index).

## Rules

- `src/check.ts` imports no module, not a Node one, three or @pixiv/three-vrm: a browser and Node both run it.
- A refusal code is a key of `refusalDescriptions` in `src/codes.ts` and nowhere else; a new rule adds its key there.
- `src/cli.ts` is the only module that reads a file or prints; `src/bin.ts` only wires the process to it.
- Test files sit beside the module they test (`quality`'s test-layout rule); the synthetic GLB builder in `tests/glbBuilder.ts` writes bytes itself and never calls the check.
- No third-party model bytes enter the tree; fixtures come from the builder.
- `package.json`'s `version` is the one version source; nothing is published to npm.

## Documents

- `README.md`: read when you build figure or run `figure check`.
- `docs/VISION.md`: read when you need to know what figure is for and what it is not.
- `docs/ARCHITECTURE.md`: read when you change the parts, the trust boundary or the package.
