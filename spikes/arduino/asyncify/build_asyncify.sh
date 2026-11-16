#!/usr/bin/env bash
# Experiment only: the same sketches through binaryen's Asyncify instead of the Atomics.wait Worker.
set -euo pipefail
cd "$(dirname "$0")/.."
. /home/claude/tools/emsdk/emsdk_env.sh >/dev/null 2>&1
OPT=/home/claude/tools/emsdk/upstream/bin/wasm-opt
for s in blink i2c_slave perf; do
  em++ -Os -std=gnu++17 -fno-exceptions -fno-rtti -c asyncify/buf.cpp -o build/obj/asyncify_buf.o
  em++ -Os build/obj/sketch_$s.o build/obj/asyncify_buf.o build/libdotcore.a -o build/$s.pre.wasm \
    -sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=1048576 -sSTACK_SIZE=65536 -Wl,--export=dp_start
  $OPT -Os --enable-bulk-memory --enable-bulk-memory-opt --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int --asyncify --pass-arg=asyncify-imports@dotbench.wait_until_us build/$s.pre.wasm -o build/$s.asyncify.wasm
  printf '%-10s plain %6d B   asyncify %6d B\n' $s $(stat -c%s build/$s.wasm) $(stat -c%s build/$s.asyncify.wasm)
done
