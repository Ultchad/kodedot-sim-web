# Browser-side compile for dotbench: feasibility spike

Branch `spike/browser-cc` (from `area/parts`). Everything here was run on this branch; commands at the end. Nothing outside `spikes/browser-cc/` was changed.

## Answer: yes, with limits

A user's Arduino sketch is compiled and linked entirely in a browser tab (clang and wasm-ld running as WebAssembly in a Worker), offline once the assets are cached, into a plain wasm32 module that **the existing part runtime loads unchanged** (ABI 1, no second loader). The three ESP32 example sketches built in the browser pass the same scenario steps as their offline-built versions (16, 11 and 14 steps), in Node and in headless Chrome under the production COOP/COEP headers and CSP.

The limits that matter: a one-time download of about 17 to 22 MB, about 300 to 400 MB of renderer memory while the toolchain is loaded, a first compile of 1 to 3 seconds, recompiles of 0.2 to 0.5 seconds for ordinary sketches, large or STL-heavy sketches in the seconds, no exceptions/RTTI/threads (same as arduino-esp32 defaults and the offline flow), and Chrome is the only browser I could run.

## What was built (all in `spikes/browser-cc/`)

| File | Role |
|---|---|
| `01-fetch.sh` | `npm pack @yowasp/clang@22.0.0-git20542-10` into `build/yowasp` |
| `02-prepare.mjs` | builds the shippable bundle in `build/site/cc`: trimmed headers, per-board precompiled core (`libdotcore.a`), precompiled header, patched yowasp runtime, one-file worker bundle |
| `03-sizes.mjs` | raw / gzip -9 / brotli q11 size of every shipped file |
| `lib/cc-driver.js` | exact `clang -cc1` and `wasm-ld` command lines (board table, PCH) |
| `lib/compiler.js` | sketch text to wasm: `ino2cpp` (the CLI's own file), fields header, compile, link, diagnostics parsing, extra sources (libraries) |
| `lib/assets.js`, `lib/cc-worker.js` | asset loading (fetch + Cache API in the browser, files in Node), the Worker protocol |
| `core/wasi_shim.cpp`, `core/libc_extras.cpp` | browser-flavour-only objects, see "Target and ABI" |
| `boards/uno/` | a second board flavour (pin map, `avr/pgmspace.h` shim) |
| `demo-node.mjs` | Node: compile in a `worker_threads` Worker, build a `.dotpart`, run all scenarios on the real runtime |
| `demo-browser.mjs`, `server.mjs`, `page/` | headless Chrome: production headers and CSP, blob Worker, cold / returning / offline, timings, memory |
| `demo-upload.mjs` | edit, compile, "upload" into a part already wired on the bench |
| `features.mjs` | what compiles, links and runs (21 cases) |
| `run-all.sh` | all of the above in order |

## Target and ABI

The Emscripten parts are already **standalone wasm32 with no JS glue and no WASI**: the only imports are `dotbench.*`, the exports are the ABI 1 list, and the blocking transport is a separate SharedArrayBuffer mailbox, not the module's memory. So the browser flavour does not need shared memory, JS glue or a second loader: it needs a wasm32 module with the same imports/exports.

Chosen: **wasm32-unknown-wasip1 with wasi-libc, libc++ and compiler-rt from the yowasp sysroot**, linked as a reactor (`crt1-reactor.o`, `_initialize`, `--no-entry --export=dp_start --stack-first -z stack-size=... --initial-memory=N --max-memory=N`, N from the manifest's `memory_kb`). Result: imports are exactly a subset of `dotbench.*`, exports are `memory, _initialize, dp_start, dp_scratch, dp_i2c_slave_event, dp_pin_event, dp_uart_rx`, and `readDotpart` / `checkWasmModule` accept it (all 3 examples, 2 boards). No stripping step was needed.

Two things wasi-libc needed that Emscripten's libc hides:

1. **WASI imports.** `fd_write`, `fd_close`, `fd_seek` appear as soon as `snprintf`/`printf` are linked, and the importer rejects any non-`dotbench` import. `core/wasi_shim.cpp` defines all 45 `__imported_wasi_snapshot_preview1_*` names libc.a can reference as ordinary functions: stdout/stderr go to the part console (so `printf`/`puts` work like `Serial.print`; `fd_fdstat_get` reports a character device so stdio line-buffers), `exit`/`abort` trap, clocks return the bench clock, everything else returns an error code. (Defining only the `__wasi_*` wrappers does not work: libc.a's `__wasilibc_real.c.obj` gets pulled in and wins.)
2. **`itoa`, `ltoa`, `utoa`, `ultoa`, `dtostrf`.** ArduinoCore-API's `String.cpp` needs them. **This is a bug in today's offline flavour too**: `tools/dotbench part build` fails to link any sketch that uses `String` (`undefined symbol: itoa`, `dtostrf`; reproduced on a copy of the blink-echo part). `core/libc_extras.cpp` implements them; they belong in `runtime/parts/core/dotcore.cpp` for both flavours.

Output sizes (`-Os`): browser build 9,148 / 25,596 / 25,360 B for blink-echo / i2c-slave / button-led, against 5,200 / 14,224 / 14,112 B offline (Emscripten). Both far under the 2 MB limit; the difference is wasi-libc's stdio and libc++ pieces.

## The split (what is precompiled, what is compiled in the tab)

Precompiled once by `02-prepare.mjs` (with the same yowasp clang and flags the browser uses, so object and header versions cannot drift): `dotcore.cpp`, ArduinoCore-API `Print Stream String IPAddress Common`, the two shim files, archived into `libdotcore.a` (60,636 B) per board; a precompiled header (`Arduino.h Wire.h SPI.h Preferences.h dotbench.h`, 1.6 MB raw) per board; the libc/libc++/libc++abi/compiler-rt archives and crt1 are the yowasp ones, copied as they are.

In the tab: `ino2cpp` (the CLI's file, unchanged), the generated `dotbench_fields.h`, `clang -cc1` on the sketch (+ any `.cpp` of libraries), `wasm-ld` against `libdotcore.a` and the sysroot. `-cc1` and `wasm-ld` are called directly: the `clang++` driver wrapper of `@yowasp/clang` first runs `clang -###`, a whole extra instantiation of the 75 MB module, just to print these command lines.

## Measurements

Machine: 2 vCPU Xeon 2.1 GHz shared with other engineers' builds (load average 2.2 to 4.6 during the runs), Node 22.23, Chrome 153 headless. Timings below are noisy; ratios inside one run are more reliable than absolute values.

### Download (what must be shipped), `03-sizes.mjs`

| File | raw | gzip -9 | brotli q11 | what |
|---|---:|---:|---:|---|
| `llvm.core.wasm` | 75,532,134 | 22,804,749 | 14,640,480 | clang + lld + LLVM tools as one WASI-command core module (from `@yowasp/clang`, unmodified) |
| `llvm.core2/3/4.wasm` | 43,871 | 16,009 | 13,431 | glue modules |
| `inc.pack` | 8,892,354 | 1,224,831 | 845,777 | trimmed headers: clang builtins (allow-list), libc++ (without the C++03 copy), wasi-libc |
| `lib.pack` | 5,387,268 | 1,311,242 | 908,928 | libc.a, libc++.a, libc++abi.a, compiler-rt builtins, crt1-reactor.o |
| `board-esp32.pack` | 1,812,793 | 918,924 | 704,571 | dotcore + ArduinoCore-API headers, libdotcore.a, PCH |
| `board-uno.pack` | 1,812,630 | 918,981 | 703,629 | same for the Uno flavour |
| `cc-worker.bundle.js` | 212,804 | 28,072 | 21,595 | compiler, driver, asset loader, patched yowasp runtime (rolldown bundle) |
| **total (2 boards)** | **93,696,073** | **27,223,735** | **17,839,259** | one board: about 0.7 MB less |

The two big text parts of the original npm package were cut down: `llvm-resources.tar` (29.7 MB) became `inc.pack` + `lib.pack` (14.3 MB raw, 2.1 MB brotli). In Chrome the cold load moved 21,935,386 B over the wire with brotli q5 from a loopback server (the CDN's level is unknown). Download time is arithmetic, not measured: 17.8 MB (brotli) is 2.9 s at 50 Mbit/s and 14 s at 10 Mbit/s; 27.2 MB (gzip) is 4.4 s and 22 s.

Licences: LLVM, clang, lld, libc++, libc++abi, compiler-rt are Apache-2.0 WITH LLVM-exception (the libc++ headers carry that SPDX line, checked); ArduinoCore-API is LGPL-2.1-or-later (as in the existing core, the sketch's sources ship in the `.dotpart`); the yowasp glue is ISC per its `package.json` while its README says Apache 2, and **the npm tarball contains no LICENSE file**; wasi-libc's licence text is not in the sysroot tar either. Both notices must be collected before shipping (not done).

### Time (Chrome 153, `demo-browser.mjs`, same page and CSP as production)

| | measured |
|---|---|
| Cold load: fetch + `compileStreaming` of the 4 modules, unpack packs, first no-op run (loopback, so no network time) | 1.09 s (Chrome compiles wasm lazily: `llvm.core.wasm` itself took 1.0 s) |
| First compile of blink-echo after a cold load | 0.89 s (cc 0.69 + link 0.20) |
| Returning visit (page reloaded, assets from the Cache API, no network): ready | 0.53 s |
| ...and its first compile | 1.2 s (functions are lazily compiled again; V8 did not reuse compiled code for Cache API responses) |
| Offline (server stopped): toolchain ready / compile | 0.62 s / 1.5 s, zero network requests |
| Recompile of blink-echo, median of 7, precompiled header ON | 218 ms (cc 141 + link 77) |
| ...precompiled header OFF | 496 ms (cc 380 + link 73), so the PCH is worth about 2.3x |
| Trivial sketch, light PCH vs. a PCH that also holds `<vector> <string> <map> <functional> <algorithm> <cmath>` (Node, load 4.6) | about 140 ms vs. 385 to 500 ms |
| A sketch that includes those STL headers, light PCH vs. STL PCH | 2.9 to 3.6 s vs. 0.9 to 1.2 s (first run 7.1 s vs. 2.7 s) |
| Scaling, synthetic String-heavy functions, PCH on | 356 lines 1.9 s; 1,406 lines 4.2 s; 5,606 lines 28 s (clearly worse than linear) |
| Prepare step (`02-prepare.mjs`), both boards | 13 to 25 s |

Node `worker_threads` numbers are close (first compile 0.8 to 2.0 s, warm 0.2 to 0.4 s).

Note: yowasp's LLVM reports `Build config: +assertions` (visible in `clang -###`). A release build of LLVM would be faster and smaller; not tried.

### Memory (Chrome renderer RSS, `ps`; `measureUserAgentSpecificMemory` did not see the wasm memory and is not used)

Renderer processes: 399 MB with the page open, 674 MB after loading the toolchain and the first compile (+275 MB), 782 MB after the 5.6k-line compile (+383 MB), 635 MB after a reload and restart (+236 MB). Each `clang`/`wasm-ld` run instantiates a fresh 17 MB-initial-memory instance (max 4 GiB declared); a big sketch grows it.

### Estimate for a normal laptop (not measured)

This box is a shared 2 vCPU server core at 2.1 GHz; single-thread wasm speed on a recent laptop is likely 1.5x to 3x better. Expect first compile 0.4 to 1.5 s, recompile 0.1 to 0.25 s for sketches of a few hundred lines, cold download dominated by the network (about 3 to 15 s on 50 to 10 Mbit/s), memory the same order as above. Treat as a guess until run on real hardware.

### Error messages

Clang diagnostics point at the sketch's own lines because `ino2cpp` emits `#line` (same as the CLI). Real output:

```
main.ino:2:21: error: expected ';' after expression
    2 |   pinMode(2, OUTPUT)
      |                     ^
      |                     ;
main.ino:7:3: error: use of undeclared identifier 'delayy'; did you mean 'delay'?
    7 |   delayy(500);
/dotcore/esp32/include/api/Common.h:124:6: note: 'delay' declared here
main.ino:8:7: error: cannot initialize a variable of type 'int' with an lvalue of type 'const char[5]'
3 errors generated.
```

`parseDiagnostics` turns that into `{file, line, col, severity, message}` objects (110 ms for this sketch). Link errors come as `wasm-ld: error: /sketch.o: undefined symbol: xTaskCreate` (no line; the CLI's friendly "see section 2.3" text is not implemented in either flavour). A too-large static array gives `wasm-ld: error: initial memory too small, 2069616 bytes needed` (should be rewritten to mention `memory_kb`).

## What works and what does not (`features.mjs`, all 21 cases give the expected result)

| Feature | Result |
|---|---|
| `std::vector/string/map/function`, lambdas, `<algorithm>`, `<cmath>` | works, but costs seconds without the STL PCH |
| Arduino `String`, `Serial.printf`, `Serial.println(float, n)`, `random/map/constrain` | works (after the `itoa`/`dtostrf` fix, which the offline flavour also needs) |
| `printf`, `puts` | work, output goes to the part console |
| `Wire` (master and slave), `SPI`, `Preferences`, `attachInterrupt`, `millis/delay`, `Serial1` | work: same `dotcore.cpp`; the 3 example scenarios (UART echo, I2C slave, button IRQ) pass |
| Libraries as source (`Foo/src/Foo.h` + `Foo.cpp`) | works; only a toy library was tried, no real third-party library (Adafruit etc.) |
| Exceptions, RTTI (`dynamic_cast`, `typeid`) | compile error ("cannot use 'throw' with exceptions disabled", "requires -frtti"): same as arduino-esp32 defaults and the offline flow |
| FreeRTOS, `WiFi.h`, `avr/pgmspace.h` | `file not found` (not in dotcore; the real ESP32 core does have `avr/pgmspace.h`, so ship the Uno shim for esp32 too) |
| `std::thread` | compiles, aborts at run time with a console message and the part is flagged crashed (the CLI would not compile it either; component-api 2.3 says "unsupported") |
| Memory | `malloc` beyond the part's memory returns NULL; `new` aborts with "bad_alloc was thrown in -fno-exceptions mode" (crashed); stack overflow traps (crashed); static data beyond `memory_kb` is a link error |
| 32-bit `int`/`long`, 64-bit `long long`, `Print` prints `ovf` above 4294967040.0 | as on the ESP32 |
| Tight loop with no imports | part flagged busy (runtime watchdog, same as offline) |
| Interrupt delivery | only at import calls, as in the existing runtime |

Boards: a board is an include dir with its own `pins_arduino.h`, its own macros, its own `libdotcore.a` and PCH. The Uno flavour compiles and runs: `LED_BUILTIN` 13, `A0` 14, `digitalPinToInterrupt(2)` 2, `PROGMEM`/`pgm_read_byte` through the shim, `ESP32` not defined (dotcore's `Arduino.h` defines it unconditionally, so the Uno copy is patched). It is **wasm32 semantics, not an AVR**: `int` is 32 bits (a sketch relying on 16-bit wraparound behaves differently), no `PORTB`/`DDRx`/`ISR(...)` vectors/`avr/io.h`, no 2 KB RAM limit, `Servo`/`EEPROM` AVR implementations unavailable. Real pin names for a Uno part still come from that part's manifest.

"Upload" (`demo-upload.mjs`): an instance already wired with a field set gets a new compile; `registerPart(def2)`, `part.def = def2` (an internal assignment: the runtime has no public call for this), `restartPart(instance)`; the instance runs the new firmware, wires and fields kept; 755 ms from edit to running.

## Constraints of the site

- CSP `script-src 'self' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src 'self' blob:` is enough: the compiler Worker is a blob module Worker made from one bundled script (a blob Worker cannot resolve relative imports, and a second request per module would break the offline case), `WebAssembly.compileStreaming` needs only `wasm-unsafe-eval`, the Cache API needs nothing. No page error, no CSP violation, no request outside the origin in the Chrome run. The compiler Worker does not need cross-origin isolation; the part Workers do (as today).
- A **service worker is refused by the current CSP** (checked in Chrome: `violates the following Content Security Policy directive: "worker-src blob:"`). So "offline after the first load" holds for the toolchain (Cache API, tested with the server stopped) but not for the page shell, which would need `worker-src 'self' blob:` and a service worker (not tried).
- Browser facts from `@mdn/browser-compat-data` 8.1.9 (data, not a test): module Workers Chrome 80, Firefox 114, Safari 15; Atomics.wait Chrome 68, Firefox 78, Safari 15.2; `compileStreaming` Chrome 60, Firefox 58, Safari 15; Cache API Chrome 40, Firefox 41, Safari 11.1; `DecompressionStream` (gzip) Chrome 80, Firefox 113, Safari 16.4; its `brotli` format Chrome no, Firefox 147, Safari 18.4. I checked what the 75 MB module needs with `wasm-opt` (validation fails without bulk-memory, passes with only mutable-globals, sign-ext, non-trapping float-to-int, multivalue and bulk-memory): bulk-memory is the newest requirement (Chrome 75, Firefox 79, Safari 15.1).
- **Not run: Firefox and Safari (no binary here)**. Unknown there: how long a full compile of the 75 MB module takes (Chrome's lazy compilation hid most of it), memory, and iOS memory limits. Safari storage eviction of the Cache API was not checked.

## Vercel Hobby (from the docs fetched on 2026-11-17, and from file sizes)

- Verified in the docs: "Static File uploads: 100 MB (Hobby), 1 GB (Pro)", defined as the size of source files uploaded by a CLI deploy. The bundle is 93.7 MB raw (75.5 MB in one file), so it must **not** be committed or uploaded as source; fetch and prepare it in the build (`01-fetch.sh` + `02-prepare.mjs`, needs npm access at build time, not tried on Vercel). No cap on the number or size of build output files is stated (only that very many files lengthen builds); the largest file is 75.5 MB and there are about 10 files.
- Verified: Hobby includes the first 100 GB of Fast Data Transfer per month: at 17.8 to 21.9 MB per cold visitor that is roughly 4,500 to 5,600 cold loads a month (arithmetic); returning visitors read the Cache API and cost nothing.
- Verified: the CDN compresses `wasm` and `tar` MIME types automatically when the client sends Accept-Encoding; the list is "not exhaustive". My `.pack` files are `application/octet-stream` and would probably not be compressed (14.3 MB raw instead of 2.1 MB): ship them pre-compressed (gzip, read with `DecompressionStream`, which every target browser has) or give them a compressible type.
- Could not verify: any per-file limit on static build output; the CDN's brotli level; Cache-Control behaviour for a 75 MB file; a real deployment (nothing was deployed). GitHub's own 100 MB hard / 50 MB warning limit for committed files is from memory, not checked.

## Recommended production design

**Assets** (`/cc/<toolchain-hash>/...`, content-hashed names, `Cache-Control: public, max-age=31536000, immutable`): `llvm.core*.wasm` (served as `.wasm`), `sysroot-inc` and `sysroot-lib` (pre-compressed), `board-<id>` (headers, `libdotcore.a`, light PCH), optional `pch-stl-<id>`, library packs by name. The worker bundle (21 KB brotli) is part of an app chunk, turned into a blob URL.

**Lazy loading:** nothing is fetched until the user opens the code editor; show the size (about 17 MB) before the first download, with a progress bar (the yowasp runtime has a `fetchProgress` hook), then fetch the active board's pack. Other boards, the STL PCH and library packs on demand (the spike loads all packs up front because yowasp attaches resource trees once). Pick the PCH by scanning the sketch's `#include` lines (STL tier or light tier: a trivial sketch is 3x slower with the big PCH, an STL sketch 3x faster).

**Caching:** Cache API keyed by toolchain hash, delete old hashes, ask for `navigator.storage.persist()`; keep the Worker alive while the editor is open and terminate it after a few idle minutes (about 275 MB); a cancelled or runaway compile is `terminate()` plus a restart (about 0.6 s).

**Compile to part:** project files (manifest + `.ino`/`.cpp`/`.h` + library folders) from the page's store, to the compile Worker, to wasm; check the ABI with `checkWasmModule`; build the `.dotpart` in the page (`lib/zip-stored.js`, sha256 via `crypto.subtle`) so the importer, the import dialog and "export part" are the same code as for files; `bench.loadPart(bytes)` and a new public `bench.replacePartDef` that re-points every instance of that id and restarts it, keeping wires and fields. Record the toolchain (`yowasp-clang-<ver> / wasi-libc / dotcore <hash>`) in the manifest `build` block, and mark the flavour so a part built offline with Emscripten and one built in the browser are distinguishable.

**Boards:** per board an include dir (pin map, macros, library-selection macros), a `libdotcore.a` and a PCH, all produced by the offline tool with the same clang; about 0.7 MB brotli each. Library availability is per board: the Uno flavour must say plainly that it is wasm32 semantics.

**Offline-first CLI parity:** keep `tools/dotbench part build` (Emscripten) as the fallback and for CI; both flavours share `ino2cpp`, the fields header and the zip packer (extract them into one pure ESM module).

## Work list to productise

1. Fix the shared core: add `itoa`/`ltoa`/`utoa`/`ultoa`/`dtostrf` to `dotcore.cpp` (the offline flavour fails to link `String` today), ship `avr/pgmspace.h` on every board, decide on `printf` to the console for Emscripten too.
2. Move `ino2cpp`, `fieldsHeader` and the package writer into one dependency-free module used by the CLI and the page; delete the copies in `lib/`.
3. Toolchain bundle as a build step: pinned version + sha256, content hashes, runs in the Vercel build (not committed), LICENSE/NOTICE bundle (LLVM exception text, wasi-libc, ArduinoCore-API LGPL, yowasp glue), size budget check in CI.
4. Loading UX: size warning, progress, resume, persistence, cache versioning, "offline ready" indicator, clear failure message and the "compile on your computer" fallback when instantiation fails (memory, old browser).
5. Compile service: queue, cancel, idle shutdown, out-of-memory handling, multi-file projects, libraries (per-library object cache), two-tier PCH, board packs lazy, diagnostics to editor markers, friendly rewrites for the known messages (FreeRTOS, WiFi, AVR headers, `initial memory too small`, `std::thread` abort).
6. Runtime: public `replacePartDef`, and the reboot-after-trap policy that component-api 7.5 describes (traps are flagged crashed today, not rebooted).
7. Test Firefox and Safari (desktop and iOS): full-compile time and memory of the 75 MB module; fall back to eager-compile warnings; test on real laptops and phones to replace my estimate.
8. Evaluate a release build of LLVM with only clang and lld (no assertions, maybe `-Oz`): could cut the 75 MB and the per-compile time; unknown gain.
9. Decide offline shell: change the CSP to `worker-src 'self' blob:` and add a service worker, or accept "offline for the toolchain only".
10. Add `demo-browser.mjs` to `tests/browser` and `demo-node.mjs` to the Node suite once the bundle build is part of CI.
11. Test real libraries (Adafruit BusIO and sensor drivers, ArduinoJson, ESP32Servo) and larger sketches; investigate the worse-than-linear compile time above a thousand lines.

## Commands (exact)

```
cd spikes/browser-cc
./run-all.sh                      # all steps; or one by one:
./01-fetch.sh && node 02-prepare.mjs && node 03-sizes.mjs
node demo-node.mjs                # BROWSER-BUILT PARTS: ALL PASSED
node demo-upload.mjs              # UPLOAD DEMO PASSED
node features.mjs                 # 21 cases, exit 0
NODE_PATH=/home/claude/dotbench/web/node_modules node demo-browser.mjs   # BROWSER DEMO: PASSED
```

Final Node output: blink-echo 9 + 7 steps, i2c-slave 11 steps, button-led 14 steps passed, all three accepted by the importer. Final Chrome run: the same scenarios pass, "returning visit: toolchain assets all from the Cache API, none from the network", "offline (server stopped): toolchain starts and compiles", "no page error", "no request outside the test origin", "no CSP violation except the service worker probe".
