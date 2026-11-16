#!/usr/bin/env bash
# usage: scaffold.sh <name> "<Display name>" <#color> "<description>" <category> <glyph>...
# Creates apps/<name>/ from the kode-app-template layout and copies the shared kit into main/.
# Safe to run again: the app's own sources (main/<name>_*.c, appdata/screenshots) are not touched.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
tpl=/home/claude/src/kode-app-template
name="$1"; display="$2"; color="$3"; desc="$4"; cat="$5"; shift 5
app="$here/../$name"
mkdir -p "$app/main" "$app/appdata/screenshots"
cp "$tpl/LICENSE" "$tpl/NOTICE.md" "$app/"
sed -e "s/^project(my_app)/project($name)/" -e 's/set(PROJECT_VER "00.00.01")/set(PROJECT_VER "01.00.00")/' "$tpl/CMakeLists.txt" > "$app/CMakeLists.txt"
cp "$tpl/sdkconfig.defaults" "$app/sdkconfig.defaults"
cp "$tpl/ram_budget.txt" "$app/ram_budget.txt"
python3 - "$app" "$name" "$color" "$desc" <<'PY'
import json, sys
app, name, color, desc = sys.argv[1:5]
json.dump({"kode": "1", "color": color, "description": desc, "icon": "icon.png"}, open(app + "/appdata/app.json", "w"))
open(app + "/appdata/app.json", "a").write("\n")
PY
cp "$tpl/main/idf_component.yml" "$app/main/idf_component.yml"
cat >> "$app/main/idf_component.yml" <<'YML'
  kodediy/kscreen:
    git: https://github.com/kodediy/kode-sdk.git
    path: components/kscreen
    version: v0.1.1
YML
for f in kit.h kit.c kit_name.c kit_store.h kit_store.c; do cp "$here/$f" "$app/main/$f"; done
python3 "$here/glyphgen.py" "$app" "$@"
python3 - "$app" "$color" "$1" <<'PY'
import sys
sys.path.insert(0, sys.argv[0].rsplit("/", 1)[0] if "/" in sys.argv[0] else ".")
PY
python3 - "$here" "$app" "$color" "$1" <<'PY'
import sys
here, app, color, glyph = sys.argv[1:5]
sys.path.insert(0, here)
import glyphgen
rgb = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
glyphgen.make_icon(app + "/appdata/icon.png", glyph, rgb)
PY
echo "scaffolded $app"
