#!/usr/bin/env bash
# Runs the vitest suite, whose browser project starts headless Chromium, alone on this machine: under the fleet's probe-stack
# lock, capped at 30 minutes, with one worker.
# Usage: scripts/run_browser_tests.sh [vitest arguments]; run it from the repository after `pnpm install` and
# `pnpm exec playwright install chromium`. Add `--coverage` for the merged report, `--project browser` for the browser alone.
# Exit codes: vitest's, or timeout's when the cap cut the run.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec flock -o -w 3600 /tmp/probe-stack.lock setpriv --pdeathsig TERM timeout -k 30 1800 pnpm exec vitest run --maxWorkers=1 "$@"
