#!/usr/bin/env bash
# The one command. Builds what is missing (SDK libraries, the example apps, any app an area's
# tests ask for), then runs under Node:
#   1. the RTOS layer's unit tests
#   2. the two stage-0 acceptance tests (tests/node/acceptance/)
#   3. the tests of the named area(s), tests/node/<area>/*.test.mjs; with no area, every area's.
# usage: tests/node/run.sh [--rebuild] [area ...]
# env:   DOTBENCH_BUILD (build dir, default <repo>/build), DOTBENCH_SDK, DOTBENCH_EMSDK
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
sdk="${DOTBENCH_SDK:-/home/claude/src/kode-sdk}"
emsdk="${DOTBENCH_EMSDK:-/home/claude/tools/emsdk}"
build="${DOTBENCH_BUILD:-$root/build}"
export DOTBENCH_SDK="$sdk" DOTBENCH_EMSDK="$emsdk" DOTBENCH_BUILD="$build"
command -v emcc >/dev/null 2>&1 || { . "$emsdk/emsdk_env.sh" >/dev/null 2>&1; }

if [ "${1:-}" = "--rebuild" ]; then shift; rm -rf "$build/lib" "$build/obj"; fi
areas=("$@")
if [ ${#areas[@]} -eq 0 ]; then
  mapfile -t areas < <(cd "$here" && for d in */; do d="${d%/}"; [ "$d" != acceptance ] && ls "$d"/*.test.mjs "$d"/*/*.test.mjs >/dev/null 2>&1 && echo "$d"; done)
fi

echo "== dotbench sdk"
"$root/tools/dotbench" sdk | tail -3

# apps to build: the examples + each selected area's test_apps (from its area.json)
apps=("$sdk/examples/buttons_led" "$sdk/examples/display_lvgl")
for a in "${areas[@]}"; do
  mf="$root/runtime/drivers/$a/area.json"; adir="$root/runtime/drivers/$a"
  [ -f "$mf" ] || { mf="$root/runtime/$a/area.json"; adir="$root/runtime/$a"; }   # runtime/<area> (persist, ...)
  [ -f "$mf" ] || { echo "no such area: $a" >&2; exit 2; }
  while IFS= read -r p; do [ -n "$p" ] && apps+=("$p"); done < <(python3 - "$mf" "$sdk" "$adir" <<'PY'
import json, sys
m, sdk, d = sys.argv[1:4]
for t in json.load(open(m)).get("test_apps", []):
    kind, _, rel = t.partition(":")
    print((sdk if kind == "sdk" else d) + "/" + rel)
PY
)
done
for app in $(printf '%s\n' "${apps[@]}" | sort -u); do
  echo "== dotbench build $(basename "$app")"
  "$root/tools/dotbench" build "$app" | tail -1
done

echo "== rtos unit tests"
"$root/runtime/rtos/test/run.sh" | tail -2

rc=0
# an area's tests: tests/node/<area>/*.test.mjs and one level down (tests/node/apps/<app>/<app>.test.mjs)
for t in "$here"/acceptance/*.test.mjs $(for a in "${areas[@]}"; do ls "$here/$a"/*.test.mjs "$here/$a"/*/*.test.mjs 2>/dev/null; done); do
  echo "== ${t#$here/} (Node)"
  timeout 600 node --expose-gc "$t" || rc=1
done
# whole-device suites (kodeOS role, apps inside kodeOS): with no area given they run too; NODE_SKIP_OS=1 skips them
if [ $# -eq 0 ] && [ -z "${NODE_SKIP_OS:-}" ]; then
  for r in kodeos boot; do
    echo "== tests/node/$r/run.sh"
    "$here/$r/run.sh" || rc=1
  done
fi
[ $rc -eq 0 ] && echo "ALL TESTS PASSED" || echo "TESTS FAILED"
exit $rc
