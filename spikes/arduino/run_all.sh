#!/usr/bin/env bash
# Build everything and run every check. Exit code 0 only if all pass.
set -euo pipefail
cd "$(dirname "$0")"
rm -f build/libdotcore.a
for s in blink i2c_slave esp32_extras perf busy; do ./build.sh sketches/$s/$s.ino build/$s.wasm | sed 's/^/  /'; done
node test_blink.mjs
node test_i2c.mjs
node test_busy.mjs
node run_scenario.mjs ../../templates/component-starter
node measure.mjs
./asyncify/build_asyncify.sh 2>&1 | grep -v warning
node run_perf_worker.mjs; node asyncify/probe.mjs
