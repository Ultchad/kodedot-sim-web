#!/usr/bin/env bash
# Step 1: download the pinned @yowasp/clang from npm into build/yowasp (untrusted download: extracted into its own empty dir).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VER="22.0.0-git20542-10"
mkdir -p "$HERE/build/dl"
if [ ! -f "$HERE/build/yowasp/package/gen/bundle.js" ]; then
  rm -rf "$HERE/build/yowasp"; mkdir -p "$HERE/build/yowasp"
  (cd "$HERE/build/dl" && npm pack "@yowasp/clang@$VER" >/dev/null && tar xzf "yowasp-clang-$VER.tgz" -C "$HERE/build/yowasp")
fi
ls -l "$HERE/build/yowasp/package/gen"
sha256sum "$HERE/build/dl/yowasp-clang-$VER.tgz"
