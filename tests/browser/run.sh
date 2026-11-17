#!/usr/bin/env bash
# Headless Chrome tests of runtime/web-adapter and the areas' browser halves:
#   browser.test.mjs   the adapter with both stage-0 examples
#   persist.test.mjs   IndexedDB persistence across a full page reload (needs the `storage` example)
#   audio.test.mjs     the audio glue + AudioWorklet under the strict CSP
# Needs the example packages (run tests/node/run.sh once, or `tools/dotbench build ...`), /usr/bin/google-chrome
# (CHROME=... to override) and puppeteer-core (resolved from tests/browser/node_modules or web/node_modules).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for a in buttons_led display_lvgl storage; do
  [ -f "${DOTBENCH_BUILD:-$here/../../build}/apps/$a/$a.dotbench" ] || { echo "missing package $a: run tests/node/run.sh first" >&2; exit 2; }
done
rc=0
for t in browser persist audio; do
  echo "== tests/browser/$t.test.mjs"
  node "$here/$t.test.mjs" || rc=1
done
# apps inside kodeOS (DotbenchSystem), when its packages are built (tests/node/boot/run.sh)
if [ -f "${DOTBENCH_BUILD:-$here/../../build}/apps/kodeos/kodeos.dotbench" ]; then
  echo "== tests/browser/boot/run.sh"
  "$here/boot/run.sh" || rc=1
else
  echo "== tests/browser/boot: skipped (run tests/node/boot/run.sh first)"
fi
[ $rc -eq 0 ] && echo "BROWSER TESTS PASSED" || echo "BROWSER TESTS FAILED"
exit $rc
