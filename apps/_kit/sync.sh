#!/usr/bin/env bash
# Copy the shared kit into every app's main/ (each app is its own repository on the catalog, so each carries a copy).
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for app in "$here"/../*/; do
  [ -f "$app/CMakeLists.txt" ] || continue
  for f in kit.h kit.c kit_name.c kit_store.h kit_store.c; do cp "$here/$f" "$app/main/$f"; done
done
