#!/usr/bin/env bash
# USB area, whole-device part: kodeOS + the three factory apps the tests use, then tests/node/usb/*.usb-test.mjs. The cable test
# (cable.test.mjs, app role under examples/power) runs with `tests/node/run.sh usb`; this script runs both.
# usage: tests/node/usb/run.sh        env: DOTBENCH_BUILD, USB_ONLY=<substring of a check>
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
sdk="${DOTBENCH_SDK:-/home/claude/src/kode-sdk}"; kos="${DOTBENCH_KODEOS:-/home/claude/src/KodeOS}"
export DOTBENCH_BUILD="${DOTBENCH_BUILD:-$root/build}"
command -v emcc >/dev/null 2>&1 || . "${DOTBENCH_EMSDK:-/home/claude/tools/emsdk}/emsdk_env.sh" >/dev/null 2>&1
"$root/tools/dotbench" sdk | tail -1
"$root/tools/dotbench" sdk --role kodeos | tail -1
"$root/tools/dotbench" build "$kos" --role kodeos | tail -1
for a in "$sdk/examples/power" "$sdk/examples/display_lvgl" "$sdk/examples/buttons_led" "$root/apps/kody_kart"; do "$root/tools/dotbench" build "$a" | tail -1; done
rc=0
for t in "$here"/cable.test.mjs "$here"/*.usb-test.mjs; do
  echo "== ${t#$root/} (Node)"
  timeout 900 node --expose-gc "$t" || rc=1
done
[ $rc -eq 0 ] && echo "USB TESTS PASSED" || echo "USB TESTS FAILED"
exit $rc
