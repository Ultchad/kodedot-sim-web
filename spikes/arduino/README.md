# Arduino-as-a-component spike (throwaway)

Question: can real, unmodified Arduino sketches run as dotbench components in WebAssembly, against
the official ArduinoCore-API plus a small web HAL, with the bench driving them from JS?
Answer: yes for GPIO + `delay()` + Serial + Wire slave. Details, numbers and gaps below.
Design that grew out of it: `../../docs/component-api.md`.

## Third-party sources (read only, outside this repo)

| What | Where | Commit | Licence |
|---|---|---|---|
| arduino/ArduinoCore-API 1.5.2 (the API layer we use) | /home/claude/src/third/ArduinoCore-API | 0f4e57ea193a00163ae59f0f0ff478feae7eb5db | LGPL-2.1-or-later (headers say "version 2.1 ... or (at your option) any later version", so it combines with GPL-3.0-or-later) |
| pschatzmann/Arduino-Emulator (evaluated, not used) | /home/claude/src/third/Arduino-Emulator | 350f8dafcf712553fbb285bf68f80900fac41706 | LGPL-2.1 |
| bxparks/EpoxyDuino (evaluated, not used) | /home/claude/src/third/EpoxyDuino | 72fc3c50641bfb926a0ecf02d68ef6e6698743ad | MIT |

## Layout

- `core/` dotcore: `Arduino.h`, `Wire.h`, `dotcore.cpp` (the HAL), `dotbench_abi.h` (the imports).
- `ino2cpp.mjs` the IDE's .ino preprocessing, minus ctags (adds `#include <Arduino.h>` and forward prototypes).
- `build.sh` sketch.ino -> standalone .wasm. `run_all.sh` builds and runs everything; output of the last run is in `RESULTS.txt`.
- `host/` the tiny bench: `bench.mjs` (clock, mailbox, outbound ring, I2C master from the device side), `component_worker.mjs` (the component's Worker and its imports), `layout.mjs` (shared-memory layout).
- `genfields.mjs`, `run_scenario.mjs` throwaway versions of what `dotbench part build` / `dotbench part test` will do: manifest.json to `dotbench_fields.h`, and a JSON scenario runner (used on `templates/component-starter`).
- `sketches/` blink (the stock Arduino example), i2c_slave (Wire slave + Serial.printf), esp32_extras (compile-only: ledc, analogRead, Wire master), perf, busy.
- `asyncify/` the rejected alternative, built and measured for comparison.

## Commands (exact)

```
cd /home/claude/dotbench/spikes/arduino
./build.sh sketches/blink/blink.ino build/blink.wasm
./build.sh sketches/i2c_slave/i2c_slave.ino build/i2c_slave.wasm
node test_blink.mjs        # (1) Blink: edge timestamps and period
node test_i2c.mjs          # (2) I2C slave: bytes and Serial output
./run_all.sh               # everything, ~15 s
```

`build.sh` runs (flags abbreviated): `em++ -Os -std=gnu++17 -fno-exceptions -fno-rtti -I core -I ArduinoCore-API ... -c`
for `dotcore.cpp` and ArduinoCore-API's `Print Stream String IPAddress Common`, archives them to
`build/libdotcore.a` (built once), runs `node ino2cpp.mjs sketch.ino`, compiles the result, and links with
`-sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=0 -sINITIAL_MEMORY=1048576 -sSTACK_SIZE=65536 -Wl,--export=dp_start`.
The module has no WASI imports and no JS glue: its only imports are the `dotbench.*` functions of `core/dotbench_abi.h`.
The host must call `_initialize()` (static constructors, since there is no `main`) and then `dp_start()`.

## What passed (see RESULTS.txt)

- The starter folder's own sketch (`templates/component-starter/src/main.ino`, an LM75-style sensor whose temperature comes from a manifest field) builds and passes its `tests/sensor.test.json` (9 steps: boot text, register read 22.5 C = [22,128], live field change to -10.25 C = [245,192], NACK at another address, writable config register, output counter).
- Blink, unmodified. Stepped virtual clock: 7 edges at exactly 0, 1000000, 2000000 ... 6000000 us, every interval exactly 1000000 us; 6 virtual seconds ran in 35 to 96 ms of wall time. Realtime clock: 6 intervals of 1000250 to 1000495 us over five runs (about 0.3 ms late per second, the cost of `Atomics.wait` wake-up plus our BigInt time math; an occasional outlier of 1.3 ms was seen in an earlier run).
- I2C slave at 0x42, unmodified ESP32-style sketch (`Wire.begin((uint8_t)0x42)`, `onReceive`, `onRequest`, `Serial.printf`). Host does `write [0x01]` + repeated start + `read 4` and gets `[0x21,0x32,0x43,0x54]`; a probe at 0x50 is NACKed; a 3-byte write sets register 2 and 3; a read-only transaction continues at the pointer; the Serial text matches line for line.
- Sizes: blink 2146 B, i2c_slave 11645 B, esp32_extras 11392 B, perf 11456 B, busy 2030 B (all .wasm, -Os).
- A sketch stuck in `while(1){}` freezes its heartbeat counter and `worker.terminate()` returns in 3 to 11 ms.
- Costs in Node 22: first component ready (spawn to `setup()` done) about 39 to 52 ms; one I2C write_read round trip bench to component and back about 42 to 57 us; 8 parked components +78 to 89 MB RSS; build with the cached core archive 0.75 s per sketch, cold (core rebuilt) 1.8 s (one V8 isolate each).

## Blocking strategy: Atomics.wait Worker vs Asyncify (measured)

Both built from the same objects (`asyncify/build_asyncify.sh` runs binaryen `wasm-opt --asyncify` on the
same link, async import = `wait_until_us`; `asyncify/probe.mjs` drives it).

| | Atomics.wait in a Worker (chosen) | Asyncify |
|---|---|---|
| .wasm size, blink / i2c_slave / perf | 2146 / 11645 / 11456 B | 3998 / 17312 / 16867 B (+47% to +86%) |
| 20M-iteration compute loop | 48 to 58 ms | 54 to 60 ms (no real difference: the loop holds no async call) |
| 3000 Serial.print calls | 3.5 to 12 ms (dominated by our per-record BigInt timestamping in JS, not by the design) | 0.7 to 1.2 ms |
| Needs | one Worker per MCU component, SharedArrayBuffer (COOP/COEP, already required by the device) | nothing special, runs anywhere |
| Serving an I2C slave transaction while the sketch sleeps in `delay()` | yes, re-entrant call from inside the wait | yes if the callback itself never sleeps (probe: read returned the right 4 bytes) |
| A callback that calls `delay()` (clock stretching style) | works (nested wait) | impossible: Asyncify cannot nest sleeps |
| Blocking master calls (`Wire.requestFrom`) | a plain blocking import, nothing instrumented | every function on the path to the import gets instrumented |

## What fought us

1. `ArduinoAPI.h` does not include `HardwareSerial.h`, `HardwareI2C.h`, `HardwareSPI.h`: a core must add them.
2. `Common.h` declares `int main()` as `extern "C"` (clang `-Wmain` noise, silenced with `-Wno-main`) and its `F()` collides with a naive redefinition; the API's own `F()` is used.
3. `Wire.write(0x00)` is ambiguous with `Print::write(const char*)` unless the class has the `int/long/unsigned` overloads that arduino-esp32's `TwoWire` has. Mirrored.
4. `Wire.begin(0x42)` means SDA=0x42 on arduino-esp32 (int overload wins); slave sketches must write `Wire.begin((uint8_t)0x42)`. Mirrored on purpose, so real sketches behave the same.
5. A standalone module has no `main`: C++ static constructors only run if the host calls the exported `_initialize()`.
6. `wasm-opt` needs `--enable-bulk-memory --enable-bulk-memory-opt --enable-sign-ext ...`; `--all-features` produced a module Node 22 refused to load.
7. `println` emits `\r\n`, as on real hardware; the test first expected `\n`.
8. Re-entrancy bug found by the starter sketch: an import called from inside a slave callback (`dotbenchField`) re-ran the pending request and recursed until the stack overflowed. Fix: the Worker claims a request with a compare-and-swap (posted 1, serving 3, done 2) before dispatching. Any bench-to-component request needs this state.
9. Forward references (function used before definition) fail without prototype generation: `use of undeclared identifier 'blinkOnce'`. `ino2cpp.mjs` fixes it with a brace-depth scanner (tested on a sketch that calls a later function).

## Notes

- `millis()`/`micros()` count from the component's power-on (`dp_start`); event timestamps in the ring are bench-absolute.

## Not proven

- Browser: everything ran under Node `worker_threads`. The component worker uses only `Atomics`, `SharedArrayBuffer`, `WebAssembly`; the browser port is a different `workerData`/fetch line, but it was not run in a browser. `Atomics.wait` on a browser Worker needs cross-origin isolation, as the device does.
- The real router: net resolution, conflicts, pull-ups, several components on one bus. Only a one-component mailbox exists.
- GPIO input, interrupts (`attachInterrupt` plumbing is in the core but untested), PWM, ADC, UART rx, SPI (no `SPI.h` yet), I2C master toward a bench part (`i2c_xfer` returns NACK), `noInterrupts()` masking.
- Third-party Arduino libraries (none compiled; Adafruit_BusIO and friends need `SPI.h`).
- Preferences, WiFi, BLE (not even stubs yet).
- `ino2cpp.mjs` is a regex-and-brace scanner: default arguments, function pointers returning functions, macros that expand to function heads and `#if`-guarded definitions are known weak spots.
- Interrupt delivery timing: events are only delivered at import calls (`delay`, `millis`, `digitalRead`, `Serial.available`, loop boundary). A tight loop with no import call never sees them.
