#!/usr/bin/env bash
# Build kodeOS, the factory apps and the crash test app, then run the boot tests (apps inside kodeOS).
# usage: tests/node/boot/run.sh           env: DOTBENCH_BUILD, BOOT_SHOTS (screenshot dir, default docs/boot-shots), BOOT_ONLY=<substring of a check>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
export DOTBENCH_BUILD="${DOTBENCH_BUILD:-$root/build}"
sdk="${DOTBENCH_SDK:-/home/claude/src/kode-sdk}"
kos="${DOTBENCH_KODEOS:-/home/claude/src/KodeOS}"
kart="${DOTBENCH_KODY_KART:-/home/claude/src/kode-app/kody_kart}"
for t in "$kos --role kodeos" "$kart" "$sdk/examples/display_lvgl" "$sdk/examples/buttons_led" "$root/runtime/drivers/apps/testapp"; do
  echo "== dotbench build $t"
  # shellcheck disable=SC2086
  "$root/tools/dotbench" build $t | tail -1
done
rc=0
for t in "$here"/*.boot-test.mjs; do
  echo "== ${t#$root/} (Node)"
  timeout 900 node --expose-gc "$t" || rc=1
done
[ $rc -eq 0 ] && echo "BOOT TESTS PASSED" || echo "BOOT TESTS FAILED"
exit $rc
