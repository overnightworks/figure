#!/usr/bin/env bash
# Runs the vitest suite, whose browser project starts headless Chromium, through the fleet's probe-run: it starts once the
# machine's load leaves room and is capped at 30 minutes, with one worker.
# Usage: scripts/run_browser_tests.sh [vitest arguments]; run it from the repository after `pnpm install` and
# `pnpm exec playwright install chromium`. Add `--coverage` for the merged report, `--project browser` for the browser alone.
# Exit codes: vitest's, timeout's when the cap cut the run, or probe-run's own (`probe-run -h`) when the load left no room
# within an hour or its arguments were refused.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec probe-run pnpm exec vitest run --maxWorkers=1 "$@"
