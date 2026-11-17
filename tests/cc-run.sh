#!/usr/bin/env bash
# The in-browser compiler: build its assets if missing, then the Node suite and (with --browser) the headless Chrome suite.
# usage: tests/cc-run.sh [--browser]       assets: build/cc-assets (or $DOTBENCH_CC_ASSETS); the browser half also needs build/apps/parts_uart (tests/node/parts/run.sh)
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NODE_PATH="${NODE_PATH:-$root/web/node_modules:/home/claude/dotbench/web/node_modules}"
[ -f "${DOTBENCH_CC_ASSETS:-$root/build/cc-assets}/manifest.json" ] || node "$root/runtime/cc/build/build-assets.mjs"
rc=0
node "$root/tests/node/cc/cc.test.mjs" || rc=1
if [ "${1:-}" = "--browser" ]; then node "$root/tests/browser/cc.test.mjs" || rc=1; fi
exit $rc
