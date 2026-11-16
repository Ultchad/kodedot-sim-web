#!/usr/bin/env bash
# Build and run the RTOS layer's unit tests (emcc -pthread, executed by Node).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RT="$HERE/.."
EMSDK="${DOTBENCH_EMSDK:-/home/claude/tools/emsdk}"
# shellcheck disable=SC1091
. "$EMSDK/emsdk_env.sh" >/dev/null 2>&1
OUT="${DOTBENCH_BUILD:-$HERE/../../../build}/rtos-test"
mkdir -p "$OUT"
emcc -O1 -g -std=gnu17 -Wall -Wno-unused-function -pthread -sPROXY_TO_PTHREAD -sEXIT_RUNTIME=1 \
     -sINITIAL_MEMORY=128MB -sPTHREAD_POOL_SIZE=24 -sENVIRONMENT=node \
     -I"$HERE" -I"$RT/include" "$HERE/rtos_test.c" "$RT/src/rtos.c" -o "$OUT/rtos_test.js"
node "$OUT/rtos_test.js"
