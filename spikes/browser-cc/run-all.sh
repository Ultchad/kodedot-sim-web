#!/usr/bin/env bash
# Everything, in order. Needs: node 22, npm + GitHub/npm reachable (first step), Chrome at /usr/bin/google-chrome, puppeteer-core via NODE_PATH.
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-/home/claude/dotbench/web/node_modules}"
./01-fetch.sh                     # @yowasp/clang 22.0.0-git20542-10 from npm -> build/yowasp
node 02-prepare.mjs               # the shippable bundle -> build/site/cc (packs, patched runtime, worker bundle, precompiled core for 2 boards)
node 03-sizes.mjs                 # raw / gzip / brotli sizes (a few minutes: brotli q11 of 75 MB)
node demo-node.mjs                # the three ESP32 sketches built in a worker_threads Worker, scenarios on the real part runtime
node demo-upload.mjs              # edit, compile, "upload" into a wired part on the bench
node features.mjs                 # what compiles, links and runs: C++ features, libraries, boards, limits
node demo-browser.mjs             # headless Chrome: production headers + CSP, blob Worker, cold / returning / offline, timings, memory
