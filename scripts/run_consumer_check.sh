#!/usr/bin/env bash
# Runs the browser layer (tests/e2e) through the fleet's probe-run: it starts once the machine's load leaves room and is
# capped at 30 minutes.
# Usage: scripts/run_consumer_check.sh [playwright arguments]; run it from the repository after `pnpm install`.
# Exit codes: Playwright's, timeout's when the cap cut the run, or probe-run's own (`probe-run -h`) when the load left no room
# within an hour or its arguments were refused.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec probe-run pnpm run test:consumer "$@"
