#!/usr/bin/env bash
# Build kodeOS for the bench (role kodeos) and run its Node tests.
# usage: tests/node/kodeos/run.sh [--rebuild]
# env:   DOTBENCH_KODEOS (kodeOS checkout, default /home/claude/src/KodeOS), DOTBENCH_BUILD, DOTBENCH_SDK, DOTBENCH_EMSDK,
#        KODEOS_SHOTS=dir to save PNGs of the milestones
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
export DOTBENCH_BUILD="${DOTBENCH_BUILD:-$root/build}"
kos="${DOTBENCH_KODEOS:-/home/claude/src/KodeOS}"
[ "${1:-}" = "--rebuild" ] && rm -rf "$DOTBENCH_BUILD/kodeos"
echo "== dotbench build $kos --role kodeos"
"$root/tools/dotbench" build "$kos" --role kodeos | tail -1
rc=0
# kodeOS-role tests of every area: tests/node/<area>/*.kodeos-test.mjs (kodeos' own first, e.g. radio/kodeos_radio)
for t in $(ls "$here"/../*/*.kodeos-test.mjs); do
  echo "== ${t#$root/} (Node)"
  timeout 600 node --expose-gc "$t" || rc=1
done
[ $rc -eq 0 ] && echo "KODEOS TESTS PASSED" || echo "KODEOS TESTS FAILED"
exit $rc
