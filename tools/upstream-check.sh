#!/usr/bin/env bash
# Is there a newer RELEASE of kode-sdk and KodeOS than the ones pinned in tools/pins.env?
#
#   usage: tools/upstream-check.sh            prints key=value lines; exit 0 (also when there is nothing new), 2 when GitHub cannot be asked
#   output (stdout, and $GITHUB_OUTPUT when set):
#     update=true|false   a release tag vX.Y.Z newer than the pins exists in BOTH repositories
#     tag=vX.Y.Z          the newest tag that both repositories have (empty when update=false)
#     reason=...          one line, for the run's summary
#
# Only tags named vMAJOR.MINOR.PATCH count (no pre-releases, no branch commits). A tag one repository has and the other does not is
# waited for: kodeOS is built against the SDK release it pins, so the pair moves together.
# env: PINS_FILE (default tools/pins.env), UPSTREAM_SDK_URL, UPSTREAM_KODEOS_URL (default: the kodediy repositories on github.com; a file path works too, for tests)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "${PINS_FILE:-$ROOT/tools/pins.env}"
SDK_URL="${UPSTREAM_SDK_URL:-https://github.com/kodediy/kode-sdk.git}"
OS_URL="${UPSTREAM_KODEOS_URL:-https://github.com/kodediy/KodeOS.git}"

tags() {   # url -> the release tags it has, one per line, oldest first
    local out
    out="$(git ls-remote --tags --refs "$1" 'v*')" || { echo "upstream-check: cannot list the tags of $1" >&2; exit 2; }
    printf '%s\n' "$out" | sed -n 's#.*refs/tags/##p' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V || true
}
newer() {  # a b -> success when version a is newer than version b
    [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$1" ]
}

sdk_tags="$(tags "$SDK_URL")"; os_tags="$(tags "$OS_URL")"
common="$(comm -12 <(printf '%s\n' "$sdk_tags" | sort) <(printf '%s\n' "$os_tags" | sort) | sort -V | tail -1)"
latest_sdk="$(printf '%s\n' "$sdk_tags" | tail -1)"; latest_os="$(printf '%s\n' "$os_tags" | tail -1)"

update=false; tag=""; reason=""
if [ -z "$common" ]; then
    reason="no release tag in common between kode-sdk and KodeOS"
elif newer "$common" "$KODE_SDK_TAG" || newer "$common" "$KODEOS_TAG"; then
    update=true; tag="$common"
    reason="release $common exists in both repositories (pinned: kode-sdk $KODE_SDK_TAG, KodeOS $KODEOS_TAG)"
else
    reason="nothing newer than kode-sdk $KODE_SDK_TAG / KodeOS $KODEOS_TAG (newest in common: $common)"
    if newer "$latest_sdk" "$common" || newer "$latest_os" "$common"; then
        reason="$reason; waiting for the pair (kode-sdk latest $latest_sdk, KodeOS latest $latest_os)"
    fi
fi
printf 'update=%s\ntag=%s\nreason=%s\n' "$update" "$tag" "$reason"
if [ -n "${GITHUB_OUTPUT:-}" ]; then printf 'update=%s\ntag=%s\nreason=%s\n' "$update" "$tag" "$reason" >> "$GITHUB_OUTPUT"; fi
