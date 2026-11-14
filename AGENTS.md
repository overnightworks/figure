# figure

## Commands

- `pnpm run` lists the package scripts. figure has no other task runner.
- `pnpm install --frozen-lockfile`: installs the dependencies; every command below needs it.
- `pnpm run check`: the type check of the sources, of the modules `src/bin.ts` reaches under Node's resolution, and of the tests.
- `pnpm run build`: emits `dist/`; the process-driven tests in `src/bin.test.ts` run it, so build first.
- `pnpm exec vitest run <file>`: one Node test file (a `*.browser.test.ts` file runs only through `scripts/run_browser_tests.sh`). Add `--coverage` for the lcov report.
- `scripts/check_packed_tarball.sh <tarball>`: installs a packed tarball into a temporary directory and runs `figure check [--as clip]` (on the clips `scripts/write_base_clips.mjs` writes) from it; CI and the release build both call it.
- `node scripts/measure_bundle_size.mjs <tarball>`: prints the gzip size of a consumer bundle that only checks and of one that also mounts, built from a packed tarball; the release build calls it and puts both lines into the notes.
- `node scripts/measure_budget_figure.mjs`: after `pnpm run build`, measures a synthetic figure and a clip at the profiles' budgets in headless Chromium (frame interval at 390 px, `slow`, the renderer, the computed GPU memory, the clip's parse); it runs itself through `probe-run` and under its memory cap, so run it directly, and beside no other browser proof, since that would skew the frame interval. A budget changes only on such a measurement.
- `scripts/run_consumer_check.sh`: the browser layer (`pnpm run test:consumer`) through the fleet's `probe-run`, set up and run as the next line says.
- `scripts/run_browser_tests.sh [vitest arguments]`: the whole vitest suite, whose browser project runs headless Chromium, through `probe-run` with one worker; add `--coverage` for the merged `lcov.info`. `pnpm run test` runs the Node project alone; CI runs `pnpm run test:coverage`. Needs `pnpm exec playwright install chromium` once; never in watch or UI mode.
- `pnpm run stage`: builds the demo stage (`tests/stage/`) into its `dist/` and serves it on 127.0.0.1:4173 under the script policy, where a figure mounts at 390 and 1280 px, with file inputs for another figure and a clip. `tests/e2e/stage.spec.ts` proves it in `pnpm run test:consumer`.
- Release: the operator dispatches `.github/workflows/release.yml` with the version, which must equal `package.json`'s. An agent dispatches it only on his yes for that one version (quality's `docs/release.md`).
- `quality check`: the shared static check. Run it at the release `.github/workflows/ci.yml` pins, after `git add` (it reads the index).

## Rules

- `src/check.ts`, `src/clipRules.ts` and `src/clipKeyRules.ts` import no module but the pure ones beside them, no Node one, three or @pixiv package: a browser and Node both run them. No module reachable from `index.ts`, `codes.ts` or `profile.ts` imports three; only `draw.ts` and what it imports do.
- A figure signal is a key of `figureSignal` in `src/signals.ts` and nowhere else. `mount` never rejects; a browser-only branch is driven in the browser project, never by a mock of WebGL.
- A gesture name is a key of `figureGesture` in `src/gestures.ts` and nowhere else; it imports nothing.
- A refusal code is a key of `refusalDescriptions` in `src/codes.ts` and nowhere else; a new rule adds its key there.
- `src/cli.ts` is the only module that reads a file or prints; `src/bin.ts` only wires the process to it.
- Test files sit beside the module they test (`quality`'s test-layout rule); the builders in `tests/glbBuilder.ts` and `tests/clipBuilder.ts` write bytes and never call the check.
- No third-party model bytes enter the tree; fixtures come from the builder.
- `package.json`'s `version` is the one version source; nothing is published to npm.

## Documents

- `README.md`: read when you build figure or run `figure check`.
- `docs/VISION.md`: read when you need to know what figure is for and what it is not.
- `docs/ARCHITECTURE.md`: read when you change the parts, the trust boundary or the package.
