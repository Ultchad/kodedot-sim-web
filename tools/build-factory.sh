#!/usr/bin/env bash
# Build kodeOS and every factory app (tools/factory-apps.json) into the build dir, and print name, size and path of each package.
# usage: tools/build-factory.sh [dest-dir]    (dest-dir: also copy each <name>.dotbench to <dest-dir>/<name>/<name>.dotbench)
# env:   DOTBENCH_BUILD, DOTBENCH_SDK, DOTBENCH_KODEOS
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk="${DOTBENCH_SDK:-/home/claude/src/kode-sdk}"; kos="${DOTBENCH_KODEOS:-/home/claude/src/KodeOS}"
export DOTBENCH_BUILD="${DOTBENCH_BUILD:-$root/build}"
dest="${1:-}"
"$root/tools/dotbench" build "$kos" --role kodeos | tail -1
names=(kodeos)
while IFS=$'\t' read -r name src; do
  case "$src" in sdk:*) src="$sdk/${src#sdk:}" ;; /*) ;; *) src="$root/$src" ;; esac
  "$root/tools/dotbench" build "$src" | tail -1
  names+=("$name")
done < <(python3 -I -c 'import json,sys
for a in json.load(open(sys.argv[1]))["apps"]: print(a["name"]+"\t"+a["source"])' "$root/tools/factory-apps.json")
for n in "${names[@]}"; do
  f="$DOTBENCH_BUILD/apps/$n/$n.dotbench"
  printf '%-14s %9d  %s\n' "$n" "$(stat -c %s "$f")" "$f"
  if [ -n "$dest" ]; then mkdir -p "$dest/$n"; cp "$f" "$dest/$n/$n.dotbench"; fi
done
