#!/usr/bin/env bash
# Move dotbench to a newer kode-sdk / KodeOS release and prove it still works. Changes nothing outside the working tree and
# never commits: the caller (the workflow .github/workflows/upstream-update.yml, or a person) commits when this exits 0.
#
#   usage: tools/upstream-update.sh [--to vX.Y.Z] [--verify-only] [--no-page]
#     --to TAG        pin kode-sdk and KodeOS at release TAG (and Kody Kart at the same tag when it has one), then run every step
#     --verify-only   keep the pins as they are and only run the steps (rebuilds the packages, runs the suites and the page checks)
#     --no-page       skip the page checks (step "page"); everything else runs
#
# Steps, in order (a failure names its step on stderr and in $GITHUB_STEP_SUMMARY, and puts the tracked files back as they were):
#   pins      resolve the tag to commits and write tools/pins.env
#   setup     tools/setup.sh: fetch the pinned trees (and Emscripten when it is not installed yet)
#   sdk       tools/dotbench sdk: precompile the SDK, LVGL and the runtime
#   factory   tools/build-factory.sh: kodeOS and the factory apps
#   kodeos    tests/node/kodeos/run.sh
#   boot      tests/node/boot/run.sh
#   areas     tests/node/run.sh <areas>
#   stage     copy the packages to web/public/apps (web/scripts/prepare-apps.mjs) and rewrite web/public/apps/SOURCES.md
#   page      a scratch copy of the tree, `npm run build`, then web/scripts/system-check.mjs, settings-check.mjs, bench-check.mjs
#             in headless Chrome
#
# env:  DEPS (default <repo>/.deps)          where the pinned trees and Emscripten live (tools/setup.sh's argument)
#       DOTBENCH_EMSDK_REUSE=<dir>           use an Emscripten SDK already installed there instead of installing one under DEPS
#       UPSTREAM_AREAS="system ble ..."      the areas of tests/node/run.sh (default: all that the owner's list names, see below)
#       UPSTREAM_RETRIES=1                   a failed suite is run once more before it counts (the tests are timing sensitive)
#       UPSTREAM_LOGS=<dir>                  where each step's full log goes (default /tmp/upstream-logs)
#       UPSTREAM_SCRATCH=<dir>               the scratch tree of the page checks (default /tmp/dotbench-page)
#       UPSTREAM_NODE_MODULES=<dir>          link this web/node_modules into the scratch tree instead of `npm ci` (offline, local runs)
#       UPSTREAM_CC_ASSETS=<dir>             link this build/cc-assets into the scratch tree instead of building the compiler assets
#       UX_PORT=<port>                       the page checks' preview port (default: a free one)
#       CHROME=<path>                        Chrome for the page checks (default /usr/bin/google-chrome)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

TO=""; VERIFY=0; PAGE=1
while [ $# -gt 0 ]; do
    case "$1" in
        --to) TO="${2:?--to needs a tag}"; shift 2 ;;
        --verify-only) VERIFY=1; shift ;;
        --no-page) PAGE=0; shift ;;
        *) echo "upstream-update: unknown argument $1" >&2; exit 64 ;;
    esac
done
[ -n "$TO" ] || [ "$VERIFY" = 1 ] || { echo "upstream-update: give --to vX.Y.Z or --verify-only" >&2; exit 64; }
[ -z "$TO" ] || [[ "$TO" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "upstream-update: $TO is not a release tag vX.Y.Z" >&2; exit 64; }

DEPS="${DEPS:-$ROOT/.deps}"
LOGS="${UPSTREAM_LOGS:-/tmp/upstream-logs}"; mkdir -p "$LOGS"
SCRATCH="${UPSTREAM_SCRATCH:-/tmp/dotbench-page}"
RETRIES="${UPSTREAM_RETRIES:-1}"
# the hardware areas the owner's acceptance list names; every one has a suite under tests/node/<area>/
AREAS="${UPSTREAM_AREAS:-system ble nfc rfid ir wifi radio usb storage sd persist nvs audio}"
TOUCHED=(tools/pins.env web/public/apps)     # what a failed run puts back
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
STEP="(start)"
RESULTS=()

say() { printf '\n== %s\n' "$*"; }
fail() {   # the step that broke, loudly, once
    local msg="FAILED STEP: $STEP"
    echo "$msg  (log: $LOGS/$STEP.log)" >&2
    { echo "### Upstream update failed"; echo; echo "- step: **$STEP**"; echo "- target: ${TO:-current pins}"; echo "- last lines of its log:"; echo '```'; tail -n 25 "$LOGS/$STEP.log" 2>/dev/null; echo '```'; } >> "$SUMMARY"
    if [ "$VERIFY" = 0 ]; then git checkout -q -- "${TOUCHED[@]}" 2>/dev/null; git clean -qfd -- web/public/apps 2>/dev/null; fi
    exit 1
}
run_logged() {   # run_logged <name> <command...>: the command under `set -e`, its output on the screen and in <name>.log; returns its status
    local name="$1"; shift
    ( set -e; "$@" ) 2>&1 | tee "$LOGS/$name.log"
    return "${PIPESTATUS[0]}"
}
step() {   # step <name> <command...>: run it, log it, stop at the first failure
    STEP="$1"; shift
    say "step $STEP"
    run_logged "$STEP" "$@" || fail
    RESULTS+=("$STEP ok")
}
suite() {  # suite <name> <command...>: as step, but a failure is run again $RETRIES times first
    local name="$1"; shift
    STEP="$name"; say "step $name"
    local n=0
    until run_logged "$name" "$@"; do
        n=$((n + 1))
        [ "$n" -le "$RETRIES" ] || fail
        echo "-- $name failed, trying once more ($n of $RETRIES): the tests are timing sensitive on a loaded machine"
    done
    RESULTS+=("$name ok$([ "$n" -gt 0 ] && echo " (after $n retry)")")
}

if [ "$VERIFY" = 0 ] && ! git diff --quiet -- "${TOUCHED[@]}"; then
    echo "upstream-update: ${TOUCHED[*]} have uncommitted changes; commit or stash them first" >&2; exit 65
fi

# ---------------------------------------------------------------- pins
pin_step() {
    [ -n "$TO" ] || { echo "keeping the pins in tools/pins.env"; return 0; }
    . "$ROOT/tools/pins.env"
    local sdk_url=https://github.com/kodediy/kode-sdk.git os_url=https://github.com/kodediy/KodeOS.git kart_url=https://github.com/kodediy/kode-app-kody_kart.git
    commit_of() {   # url tag -> the commit the tag points at (peeled when it is annotated); empty when there is no such tag
        local out; out="$(git ls-remote --tags "$1" "refs/tags/$2" "refs/tags/$2^{}")" || return 1
        printf '%s\n' "$out" | awk -v t="refs/tags/$2" '$2==t"^{}"{p=$1} $2==t{l=$1} END{print (p!=""?p:l)}'
    }
    local sdk os kart
    sdk="$(commit_of "${UPSTREAM_SDK_URL:-$sdk_url}" "$TO")" || return 1
    os="$(commit_of "${UPSTREAM_KODEOS_URL:-$os_url}" "$TO")" || return 1
    kart="$(commit_of "${UPSTREAM_KART_URL:-$kart_url}" "$TO")" || return 1
    [ -n "$sdk" ] && [ -n "$os" ] || { echo "release $TO is missing in kode-sdk or KodeOS" >&2; return 1; }
    [ -n "$kart" ] || { kart="$KODY_KART_COMMIT"; echo "Kody Kart has no tag $TO: it stays at ${kart:0:7}"; }
    python3 -I - "$ROOT/tools/pins.env" "$TO" "$sdk" "$os" "$kart" <<'PY'
import re, sys
path, tag, sdk, os_, kart = sys.argv[1:6]
want = {"KODE_SDK_TAG": tag, "KODE_SDK_COMMIT": sdk, "KODEOS_TAG": tag, "KODEOS_COMMIT": os_, "KODY_KART_COMMIT": kart}
text = open(path).read()
for k, v in want.items():
    text, n = re.subn(r"^%s=.*$" % k, "%s=%s" % (k, v), text, flags=re.M)
    assert n == 1, k
open(path, "w").write(text)
PY
    cat "$ROOT/tools/pins.env" | grep -v '^#'
}
step pins pin_step

# ---------------------------------------------------------------- setup
setup_step() {
    . "$ROOT/tools/pins.env"
    # a pinned tree that is not at its pin is stale (the pins just moved): drop it, setup.sh fetches it again
    local d want
    for pair in "kode-sdk:$KODE_SDK_COMMIT" "KodeOS:$KODEOS_COMMIT" "kode-app-kody_kart:$KODY_KART_COMMIT"; do
        d="$DEPS/${pair%%:*}"; want="${pair#*:}"
        if [ -d "$d/.git" ] && [ "$(git -C "$d" rev-parse HEAD)" != "$want" ]; then echo "dropping the stale $d"; rm -rf "$d"; fi
    done
    "$ROOT/tools/setup.sh" "$DEPS"
}
step setup setup_step
. "$ROOT/.dotbench-env"
export DOTBENCH_BUILD="$ROOT/build"

# ---------------------------------------------------------------- build
step sdk "$ROOT/tools/dotbench" sdk
step factory "$ROOT/tools/build-factory.sh"

# ---------------------------------------------------------------- suites
suite kodeos "$ROOT/tests/node/kodeos/run.sh"
suite boot "$ROOT/tests/node/boot/run.sh"
# shellcheck disable=SC2086
suite areas "$ROOT/tests/node/run.sh" $AREAS

# ---------------------------------------------------------------- stage
stage_step() {
    ( cd "$ROOT/web" && node scripts/prepare-apps.mjs ) || return 1
    . "$ROOT/tools/pins.env"
    python3 -I - "$ROOT/web/public/apps/SOURCES.md" "$KODE_SDK_TAG" "$KODE_SDK_COMMIT" "$KODEOS_TAG" "$KODEOS_COMMIT" "$KODY_KART_COMMIT" <<'PY'
import re, sys
path, sdk_tag, sdk_c, os_tag, os_c, kart_c = sys.argv[1:7]
text = open(path).read()
def row(prefix, commit_cell):   # replace the third cell of the table row that starts with `prefix`
    global text
    text, n = re.subn(r"^(\| %s \|[^|]*\|)[^|]*(\|.*)$" % re.escape(prefix), lambda m: "%s %s %s" % (m.group(1), commit_cell, m.group(2)), text, flags=re.M)
    assert n == 1, prefix
row("kodeOS", "%s (%s)" % (os_tag, os_c[:7]))
row("Kody Kart", kart_c[:7])
row("Display, Buttons + LED", "%s (%s)" % (sdk_tag, sdk_c[:7]))
open(path, "w").write(text)
PY
    cat "$ROOT/web/public/apps/SOURCES.md"
}
step stage stage_step

# ---------------------------------------------------------------- page
page_step() {
    rm -rf "$SCRATCH"; mkdir -p "$SCRATCH"
    # the working tree as it is now (tracked and new files, without what .gitignore hides), packages included
    git ls-files -co --exclude-standard -z | while IFS= read -r -d '' f; do [ -e "$f" ] && printf '%s\0' "$f"; done | tar --null -T - -cf - | tar -xf - -C "$SCRATCH"
    cd "$SCRATCH/web"
    if [ -n "${UPSTREAM_NODE_MODULES:-}" ]; then ln -s "$UPSTREAM_NODE_MODULES" node_modules; else npm ci --no-audit --no-fund; fi
    if [ -n "${UPSTREAM_CC_ASSETS:-}" ]; then mkdir -p ../build && ln -s "$UPSTREAM_CC_ASSETS" ../build/cc-assets; fi
    npm run build || return 1
    export UX_PORT="${UX_PORT:-$(python3 -I -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')}"
    echo "page checks on port $UX_PORT"
    for c in system-check settings-check bench-check; do
        echo "---- $c"
        node "scripts/$c.mjs" || { echo "page check $c failed" >&2; return 1; }
    done
    mkdir -p "$LOGS/screenshots" && cp screenshots/system-*.png "$LOGS/screenshots/" 2>/dev/null || true
}
if [ "$PAGE" = 1 ]; then step page page_step; fi

# ---------------------------------------------------------------- done
STEP="done"
{ echo "### Upstream update: all checks passed"; echo; echo "- target: ${TO:-current pins (verify only)}"; printf -- '- %s\n' "${RESULTS[@]}"; } | tee -a "$SUMMARY"
