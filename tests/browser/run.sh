#!/usr/bin/env bash
# Headless Chrome test of runtime/web-adapter. Needs the example packages (run tests/node/run.sh once, or
# `tools/dotbench build ...`), /usr/bin/google-chrome (CHROME=... to override) and puppeteer-core
# (resolved from tests/browser/node_modules or web/node_modules).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for a in buttons_led display_lvgl; do
  [ -f "${DOTBENCH_BUILD:-$here/../../build}/apps/$a/$a.dotbench" ] || { echo "missing package $a: run tests/node/run.sh first" >&2; exit 2; }
done
exec node "$here/browser.test.mjs"
