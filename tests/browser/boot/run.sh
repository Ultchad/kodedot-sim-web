#!/usr/bin/env bash
# Headless Chrome check of DotbenchSystem (needs Chrome and the packages built by tests/node/boot/run.sh).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DOTBENCH_BUILD="${DOTBENCH_BUILD:-$here/../../../build}"
for a in kodeos kody_kart light level display_lvgl buttons_led crash_app; do
  [ -f "$DOTBENCH_BUILD/apps/$a/$a.dotbench" ] || { echo "missing package $a: run tests/node/boot/run.sh first" >&2; exit 2; }
done
node "$here/boot.test.mjs"
