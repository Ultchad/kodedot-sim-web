#!/usr/bin/env bash
# Build: ArduinoCore-API (third party, LGPL-2.1+) + dotcore HAL + an unmodified .ino -> standalone .wasm
# usage: ./build.sh sketches/blink/blink.ino build/blink.wasm
set -euo pipefail
cd "$(dirname "$0")"
. /home/claude/tools/emsdk/emsdk_env.sh >/dev/null 2>&1
API=/home/claude/src/third/ArduinoCore-API
OBJ=build/obj; mkdir -p "$OBJ"
FLAGS=(${EXTRA_INC:+-I "$EXTRA_INC"} -Os -std=gnu++17 -fno-exceptions -fno-rtti -ffunction-sections -fdata-sections
       -I core -I "$API" -DARDUINO=10819 -DARDUINO_ARCH_ESP32 -DESP32 -DHOST -Wno-main)
# 1) the core: compiled once, cached as an archive
if [ ! -f build/libdotcore.a ] || [ -n "$(find core "$API/api" -newer build/libdotcore.a -type f 2>/dev/null | head -1)" ]; then
  rm -f "$OBJ"/*.o build/libdotcore.a
  for f in core/dotcore.cpp "$API"/api/{Print,Stream,String,IPAddress,Common}.cpp; do
    em++ "${FLAGS[@]}" -c "$f" -o "$OBJ/$(basename "${f%.cpp}").o"
  done
  emar rcs build/libdotcore.a "$OBJ"/*.o
fi
# 2) the sketch: .ino -> .cpp the way the IDE does it (Arduino.h + forward prototypes), then compiled as C++
SK="$1"; OUT="$2"; B="$(basename "${SK%.*}")"
case "$SK" in *.ino) node ino2cpp.mjs "$SK" > "build/sketch_$B.cpp"; SRC="build/sketch_$B.cpp";; *) SRC="$SK";; esac
em++ "${FLAGS[@]}" -x c++ -c "$SRC" -o "$OBJ/sketch_$B.o"
em++ -Os "$OBJ/sketch_$(basename "${SK%.*}").o" build/libdotcore.a -o "$OUT" \
  -sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=0 \
  -sINITIAL_MEMORY=1048576 -sSTACK_SIZE=65536 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
  -Wl,--gc-sections -Wl,--export=dp_start
ls -l "$OUT"
