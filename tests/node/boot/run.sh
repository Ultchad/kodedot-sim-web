#!/usr/bin/env bash
# Build kodeOS, the nine factory apps (tools/factory-apps.json) and the crash test app, then run the boot tests (apps inside kodeOS).
# usage: tests/node/boot/run.sh           env: DOTBENCH_BUILD, BOOT_SHOTS (screenshot dir, default docs/boot-shots), BOOT_ONLY=<substring of a check>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
export DOTBENCH_BUILD="${DOTBENCH_BUILD:-$root/build}"
echo "== tools/build-factory.sh (kodeOS + the nine factory apps)"
"$root/tools/build-factory.sh" | tail -10
echo "== dotbench build crash_app"
"$root/tools/dotbench" build "$root/runtime/drivers/apps/testapp" | tail -1
rc=0
for t in "$here"/*.boot-test.mjs; do
  echo "== ${t#$root/} (Node)"
  timeout 900 node --expose-gc "$t" || rc=1
done
[ $rc -eq 0 ] && echo "BOOT TESTS PASSED" || echo "BOOT TESTS FAILED"
exit $rc
