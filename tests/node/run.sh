#!/usr/bin/env bash
# The one command: builds what is missing (SDK libraries, both example apps) and runs
#   1. the RTOS layer's unit tests,  2. buttons_led,  3. display_lvgl   under Node.
# usage: tests/node/run.sh [--rebuild]
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
sdk="${DOTBENCH_SDK:-/home/claude/src/kode-sdk}"
emsdk="${DOTBENCH_EMSDK:-/home/claude/tools/emsdk}"
build="${DOTBENCH_BUILD:-$root/build}"
export DOTBENCH_SDK="$sdk" DOTBENCH_EMSDK="$emsdk" DOTBENCH_BUILD="$build"

command -v emcc >/dev/null 2>&1 || { . "$emsdk/emsdk_env.sh" >/dev/null 2>&1; }

[ "${1:-}" = "--rebuild" ] && rm -rf "$build/lib" "$build/obj"

echo "== dotbench sdk"
"$root/tools/dotbench" sdk | tail -3
for app in buttons_led display_lvgl; do
  echo "== dotbench build $app"
  "$root/tools/dotbench" build "$sdk/examples/$app" | tail -2
done

echo "== rtos unit tests"
"$root/runtime/rtos/test/run.sh" | tail -3

rc=0
for app in buttons_led display_lvgl; do
  echo "== $app (Node)"
  timeout 120 node "$here/$app.test.mjs" "$build/apps/$app/$app.dotbench" || rc=1
done
[ $rc -eq 0 ] && echo "ALL ACCEPTANCE TESTS PASSED" || echo "ACCEPTANCE TESTS FAILED"
exit $rc
