# STATUS: the in-browser compile service (`runtime/cc/`)

An Arduino sketch is compiled and linked **inside the page**, in a Web Worker, into a plain wasm32 module the existing part runtime accepts (ABI 1). No server: clang and wasm-ld run as WebAssembly (`@yowasp/clang`, pinned in `runtime/cc/toolchain.json`). Branch `spike/browser-cc`. Chrome is the only browser tested; **Firefox and Safari are untested**.

## What works, with numbers

All numbers measured on the shared 2-core machine with a load average of 17 to 19 (other agents running), so read them as pessimistic and noisy.

| Check | Result |
|---|---|
| Default sketch of each of the 5 boards (esp32, esp32-s3, uno-r3, uno-r4-minima, uno-r4-wifi) | compiles, importer accepts, runs, prints on its serial monitor (Node and Chrome) |
| The three ESP32 examples, built in the browser flavour | all 4 of their scenario files pass (blink-echo 2, i2c-slave 1, button-led 1) |
| Sketch with String, Servo, Wire, EEPROM, itoa | builds and runs with the expected output |
| STL sketch (vector, string, map) | picks the STL PCH tier automatically, builds, runs |
| Multi-file (two .ino, header, .cpp, a library folder) | builds, runs, files go into the package under `src/` |
| Errors | file, line, column, severity; second .ino maps to its own file; errors in generated prototypes map to the function's line; undefined symbols come as linker diagnostics; plain-language hints for AVR registers, FreeRTOS/ESP-IDF headers, WiFi, exceptions, RTTI, memory |
| Cancel | running and queued compiles resolve as `cancelled`; the next compile works (Worker replaced) |
| Persistent cache | after a reload with `/cc/` blocked at the network, `info()`, `ready()` and a compile work from the Cache API (79 MB read from cache, 0 bytes from network, 2.3 s) |
| Edit, compile, upload | `bench.setPartCode` on a running bench: the board restarts with the new code (serial monitor shows the new greeting, the Dot now receives UPPERCASE echoes), the Dot's counter never restarts, a second board keeps its console, 516 to 694 ms to compile |
| Tests | `node tests/node/cc/cc.test.mjs`: 56 checks pass. `tests/browser/cc.test.mjs`: 10 checks pass under production COOP/COEP + CSP, no request beyond the test origin. `tests/cc-run.sh [--browser]` runs both. |
| `tests/node/parts/run.sh` | all steps pass except one timing flake in `e2e_apps` (`parts_i2c` probe line) on the loaded machine; re-run alone: 32 checks pass |

Timings (Chrome, local server, brotli q4 like a CDN): cold `ready({board})` 3.9 to 6.5 s and 23.0 MB over the wire; first compile of a trivial sketch 2.6 to 3.7 s; later compiles 0.25 to 0.6 s in Node (warm); STL sketch 1.5 to 4.9 s with the STL PCH. Budgets that fail the tests on a bad regression are in `tests/node/cc/budgets.json` (about 3x the measured values).

### Sizes (`node runtime/cc/build/build-assets.mjs --sizes`)

Total output 124.7 MB stored, 34 files, none above 20 MB. Raw / gzip -9 / brotli q9:

| Asset | raw | gzip | brotli |
|---|---:|---:|---:|
| LLVM module (4 chunks, `.wasm`, CDN compresses) | 75,532,134 | 22,807,909 | 17,292,216 |
| sysroot (headers + libc/libc++ libs + core headers), stored as `.pack.gz` | 14.4 MB | 2.57 MB | 2.57 MB (already gzip) |
| per board pack (core, light PCH, manifest), `.pack.gz` | 1.68 MB | 0.90 MB | |
| per board STL PCH, `.pack.gz` (fetched only when a sketch needs it) | 13.4 MB | 8.36 MB | |
| Worker script | 130 KB | 25.6 KB | 23.0 KB |

First use of one board: about 17.3 + 2.6 + 0.9 = 21 MB on the wire (brotli wasm); measured 23.0 MB with the test server's brotli q4. The STL tier adds 8.4 MB once per board.

### Asset build and Vercel

`node runtime/cc/build/build-assets.mjs` (never committed; output `build/cc-assets`, copy it to the page's `public/cc/`): `npm pack` of the pinned package (2.2 s, integrity checked against `toolchain.json`), then trims headers, precompiles the core and two PCH tiers for each board with the **same clang the browser uses**, chunks the wasm (`--chunk-bytes`, default 20,000,000), bundles the Worker with rolldown (comes with vite in `web/node_modules`), writes `manifest.json` (file list, sizes, sha-256, versions, board data), `NOTICE.txt` and `licenses/`. **69.8 s** for all five boards at load 17 (`--sizes` adds about 17 s; `--no-stl` makes it about 20 s and 80 MB, STL sketches then fall back to the light tier). Vercel Hobby limits (docs, 2026-09-16 revision): build step 45 min, 64 GB disk, "no upper limit for output files created during a build"; the 100 MB limit is for CLI source uploads, so **do not commit the bundle**. So yes, it is realistic inside the page's `npm run build` (add it to `prebuild`), needs npm registry access at build time, and was **not run on Vercel itself**. A per-file output cap is not stated in the docs. If it ever proves too slow, commit only the small precompiled cores (about 60 KB each) and the per-board packs (0.9 MB each) and build only the toolchain part there; `--boards` selects boards.

Serve `/cc/*` with `Cache-Control: public, max-age=31536000, immutable` except `manifest.json` (no-cache); names carry content hashes. The `.wasm` chunks rely on the CDN compressing `application/wasm` (Vercel docs say it does; not verified on a deployment); `--gzip-wasm` stores them gzipped instead (22.8 MB, no CDN dependency). `.pack.gz` are inflated in the Worker with `DecompressionStream` (Chrome 80, Firefox 113, Safari 16.4 per MDN data, not tested here).

## API (`runtime/cc/index.js`, framework free)

```js
import { createCompiler } from "<runtime/cc/index.js>";
const cc = createCompiler({ assetsBaseUrl: "/cc/", onProgress });   // downloads nothing
const info = await cc.info();    // manifest only: boards, sizes, what is cached
await cc.ready({ board: "uno-r3", stl: false });   // optional: download and start now
const p = cc.compile({ board, files: { "main.ino": "...", "util.h": "...", "libraries/Foo/src/Foo.cpp": "..." }, options });
const r = await p;               // p.cancel() cancels just this one
cc.cancel(); cc.clearCache(); cc.dispose();
```

- `info()` returns `{version, toolchain, boards: {id: {name, core, partId, family, pins, capabilities, supported[], unsupported[], notes[], limits, defaultSketch: {name, text}, bytes}}, download: {toolchainBytes, toolchainMissingBytes, perBoard}, ready, manifestFromCache}`. Pins, ADC/PWM bits, EEPROM size, logic level, serial1/WiFi-stub/LED-matrix flags are derived from the variant header; the support lists are data in `runtime/cc/boards.mjs`.
- `compile` resolves (never rejects for a user error) with `{ok, wasm, partDef, diagnostics, timings, log, board, cancelled?}`. `partDef = {manifest, sha256, files, dotpart}`: `dotpart` is a `.dotpart` zip the importer accepts, produced by the same entry list as `tools/dblib/part/build.mjs` (`packageEntries`, shared). `diagnostics[i] = {file, line, column, severity, message, source: "compiler"|"linker", notes?, hint?, system?, generated?}`. `timings = {pch, ccMs, ldMs, packageMs, totalMs, loadMs, queueMs, wallMs}`; a repeated identical request returns from a small in-memory cache (`timings.cached`).
- `options`: `pch` ("auto" default, "light", "stl", "none"), `opt` (default `-Os`), `memoryKb`, `stackKb`, `main` (main .ino), `manifest` (build as another part's manifest, e.g. a user's custom part).
- Progress events: `{phase: "download", file, loaded, total, overallLoaded, overallTotal, cached}` (bytes, monotonic), `{phase: "step", step}`, `{phase: "worker", state}`.
- Files: `.ino` files (main first, the rest by name; each keeps its own name and line numbers), `.h` on the include path, `.c/.cpp/.cc` compiled, `libraries/<Name>/(src/)` like `part build`.

## Page wiring (for the front end)

1. Create the compiler once, when the code editor is first opened: `createCompiler({assetsBaseUrl: "/cc/", onProgress})`. Do not call `ready()` earlier: nothing is downloaded until then.
2. Call `info()` on opening the editor. Show `download.perBoard[board].missingBytes + download.toolchainMissingBytes` ("about 21 MB, once") before the first download, or nothing if `info.ready`. Fill the board picker and the "supported / not supported" text from `boards[id]`; start the editor with `boards[id].defaultSketch.text`.
3. Call `ready({board})` when the user confirms (or on first Compile). Drive a progress bar from `overallLoaded / overallTotal`; on `phase: "step"` show "compiling" or "linking".
4. Editor: map `diagnostics` to markers by `file`/`line`/`column`/`severity`; show `hint` under the message; `line === 0` (linker) goes on the file's header. Keep `log` for an "output" pane.
5. Compile on a button (not on every key stroke: 0.3 to 4 s). A new request while one runs queues; for "latest wins" call `p.cancel()` on the old promise (cancel of a running one costs a Worker restart, about 1 to 3 s).
6. Upload: `await bench.setPartCode(instance, {source: files["main.ino"], wasm: r.wasm, name: "sketch"})`. Only that part restarts; the rest keeps running. `bench.clearPartCode(instance)` returns to the package's sketch.
7. Serial monitor: `bench.serialLog(instance)` for the history and the bench's `"console"` event for new lines.
8. Layout/CSP: the Worker is created from a `blob:` URL (needs `worker-src blob:`; `connect-src 'self'`); it needs no cross-origin isolation, the part Workers do. No service worker (the CSP forbids it); persistence is the Cache API. Ask for `navigator.storage.persist()` is made by `ready()` (best effort; the browser may still evict).
9. Copy `build/cc-assets` to `public/cc/` in the page build (a `prebuild` step); serve with the cache headers above.

## Limits users will hit

- The sketch becomes WebAssembly (wasm32), not chip code. No exceptions, no RTTI, no threads (`std::thread` aborts, FreeRTOS tasks do not exist), no ESP-IDF headers, no Bluetooth, WiFi classes are "not connected" stubs.
- No chip registers (`PORTB`, `DDRB`, `TCCR1A`, `avr/io.h`, `ISR()`): refused at compile time with a hint. On the Uno R3 `int` is 32 bits (16 on the real chip), RAM/flash limits of the real chip are not enforced (the part has its own `memory_kb`), `PROGMEM` is ordinary data.
- Time is the bench clock in milliseconds; a loop that never touches I/O or time is flagged busy; static data larger than the part's memory fails to link ("initial memory too small").
- Libraries available: Arduino core API, Wire, SPI, Preferences, EEPROM, Servo, Stepper, WiFi stubs, Arduino_LED_Matrix (R4 WiFi), libc++ (STL, `<cmath>`, `<functional>`). Others only as the user's own files under `libraries/`.
- Compile time grows faster than linearly with source size (spike measurement: 1,400 lines about 4 s, 5,600 lines 28 s).
- First visit downloads about 21 MB (plus 8.4 MB the first time an STL sketch is built on a board).

## Changes outside `runtime/cc/` (listed for review)

- `tools/dblib/part/shared.mjs` (new, pure): `sketchToCpp`, `fieldsHeader`, `packageEntries`; `zipcore.mjs` (new, pure ZIP writer; `zipwrite.mjs` keeps the Node deflate and byte-identical output, checked); `ino2cpp.mjs` gains `sketchToCpp` (single file output identical to `inoToCpp`, tested). `build.mjs` now imports them. Offline behaviour is unchanged except one improvement: with several `.ino` files every file keeps its own name and line numbers in `#line`.
- dotcore: my small fix commit (`itoa` family, `dtostrf`, `<avr/pgmspace.h>`) overlapped with the same fix the parts engineer landed; after merging `area/parts` the duplicate in `dotcore.cpp` and `Arduino.h` was dropped. What remains of mine: `runtime/parts/core/avr/pgmspace.h`, which forwards a sketch's own `#include <avr/pgmspace.h>` to ArduinoCore-API's flat-memory copy.
- Merged `area/parts` (code-part contract: `setPartCode`, `getPartCode`, `serialLog`).

## Not done

- Firefox and Safari not tested; `DecompressionStream`, module Workers and streaming compile are used per MDN support data only.
- Not run on a real Vercel deployment (CDN compression of the `.wasm` chunks, build time there, per-file output cap unverified).
- No per-library object cache, no idle shutdown of the Worker, no compile-result persistence across visits, no third-party library downloads.
- Legal: ArduinoCore-API is LGPL-2.1 and its objects are linked into every built part (the offline tool does the same); `NOTICE` ships in the assets and in every part package, but whether that satisfies LGPL relinking is a question for the owner, not settled here.
- The offline tool still needs Emscripten; the two flavours are separate builds of the same sources (wasi-libc vs Emscripten libc), checked equal by the same scenarios, not byte-equal.
- Spike material in `spikes/browser-cc/` is kept as the record; `runtime/cc/` replaces it.
