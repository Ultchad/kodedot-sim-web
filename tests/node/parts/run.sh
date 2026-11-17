#!/usr/bin/env bash
# The parts suite: schema copies current, the built-in library (every part's own scenarios), the bench unit tests, the starter
# (new -> build -> test), the end-to-end tests with real firmware, and, with --browser, the headless Chrome test.
# usage: tests/node/parts/run.sh [--browser]     (tests/node/run.sh parts runs the Node half too, and builds the apps)
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
export DOTBENCH_BUILD="${DOTBENCH_BUILD:-$root/build}"
emsdk="${DOTBENCH_EMSDK:-/home/claude/tools/emsdk}"
command -v emcc >/dev/null 2>&1 || { . "$emsdk/emsdk_env.sh" >/dev/null 2>&1; }
rc=0
step() { echo "== $1"; shift; "$@" || rc=1; }
step "schema copies" node "$root/tools/dblib/part/gen-schema.mjs" --check
step "built-in library: build and run every part's scenarios" node "$root/parts/build-library.mjs" --test
step "bench unit tests" node "$here/bench.test.mjs"
step "circuit tests (nodal solve, capacitors, hazards)" node "$here/circuit.test.mjs"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
step "starter: new, build, test" bash -c "cd '$tmp' && '$root/tools/dotbench' part new '$tmp/demo' >/dev/null && '$root/tools/dotbench' part build '$tmp/demo' && '$root/tools/dotbench' part test '$tmp/demo'"
for a in parts_io parts_i2c parts_uart; do [ -f "$DOTBENCH_BUILD/apps/$a/$a.dotbench" ] || "$root/tools/dotbench" build "$here/apps/$a" | tail -1; done
for a in expansion_io exp_bus; do [ -f "$DOTBENCH_BUILD/apps/$a/$a.dotbench" ] || "$root/tools/dotbench" build "${DOTBENCH_SDK:-/home/claude/src/kode-sdk}/examples/$a" | tail -1; done
step "end to end with real firmware" node --expose-gc "$here/e2e_apps.test.mjs"
if [ "${1:-}" = "--browser" ]; then step "headless Chrome" node "$root/tests/browser/parts.test.mjs"; fi
[ $rc -eq 0 ] && echo "PARTS TESTS PASSED" || echo "PARTS TESTS FAILED"
exit $rc
