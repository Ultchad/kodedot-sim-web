# STATUS: parts (J3 expansion header, bench model, part runtime, CLI, built-in parts)

Branch `area/parts`, based on main 8693d2c. Design: `docs/component-api.md`. Everything below was run on this branch; the commands and their output are in "What passes".
Nothing is pushed or merged. `web/` and `apps/` are untouched. `dotbench-system.js` is unchanged (the glue event `area:exp:link` already reaches `sys.on` / `dev.on`).

## What works

| Piece | Where | State |
|---|---|---|
| J3 as a hardware area (pin drive state, levels, millivolts, I2C/SPI/UART mailbox, UART rings, ADC port, boost bit, C5 pulse bit) | `runtime/drivers/exp/` plus the small taps in `gpio`, `pwm`, `i2c` | works against the SDK's own `khal_exp.c`; `expansion_io` and `exp_bus` run unmodified |
| Bench model: parts, wires, nets, solver, power rules, hazards, buses, virtual clock, layout | `runtime/web-adapter/bench*.js` | works, 44 unit checks |
| Wasm part runtime (one Worker per part, ABI 1, mailbox, stepped clock) | `part-worker.js`, `bench-wasm.js` | works, real Arduino sketches run |
| Declarative parts (switch with bounce, bridge, divider, source, drive, i2c_slave, led, buzzer, servo, h_bridge) | `bench-declarative.js` | works; `wireless` is accepted and inert |
| `dotbench part new / check / build / test / inspect` | `tools/dotbench`, `tools/dblib/part/` | works; starter builds and its 9 steps pass |
| Built-in parts (11) | `parts/`, built to `parts/dist/*.dotpart` plus `library.json` | works, 108 scenario steps pass |
| `dotcore` (ArduinoCore-API plus Wire, SPI, Preferences, Serial, pins) | `runtime/parts/core/` | cached build under `~/.cache/dotbench/dotcore-<hash>` (cold 21 s) |

### Built-in parts

`dotbench.led` (with resistor), `dotbench.rgb-led`, `dotbench.push-button`, `dotbench.slide-switch`, `dotbench.potentiometer`, `dotbench.buzzer`, `dotbench.servo`, `dotbench.hdc1080` (I2C 0x40), and three ESP32 boards with real sketches: `dotbench.esp32-blink-echo` (blinks, echoes UART1), `dotbench.esp32-i2c-slave` (I2C slave on SDA/SCL), `dotbench.esp32-button-led`. Every part has `tests/*.test.json` scenarios; the ESP32 ones also ship `src/main.ino`.

### What passes (commands and output)

```
tests/node/parts/run.sh --browser        # everything below, in order
== schema copies                                     schema copies are current
== built-in library: build and run every part's scenarios
   buzzer 7, esp32-blink-echo 16, esp32-button-led 14, esp32-i2c-slave 11, hdc1080 9, led 8, potentiometer 8,
   push-button 11, rgb-led 7, servo 7, slide-switch 10   steps passed       built 11 parts into parts/dist
== bench unit tests                                  bench: PASSED (44 checks)
== starter: new, build, test                         all 9 steps passed in 1 scenario(s)
== end to end with real firmware                     e2e_apps: PASSED (32 checks)
== headless Chrome                                   parts browser test: PASSED   (5 checks)
PARTS TESTS PASSED
```

End to end (real firmware in a `DotbenchDevice`, the bench attached before first boot):

- `parts_io` (own app, `tests/node/parts/apps/`): the Dot blinks an LED part on EXP4 and reads a button part on EXP6; cutting the LED ground while running darkens it.
- `parts_i2c`: the Dot reads an HDC1080 part (probe 0x40 yes, 0x41 no, manufacturer 0x5449, temperature and humidity, field changes, SDA unplugged).
- `parts_uart`: the Dot and `esp32-blink-echo` (a real sketch in a Worker) exchange UART lines; TX unplugged makes the reads time out.
- SDK `expansion_io`: LED, PWM, contact (IRQ) and knob (ADC) against LED, servo, button and potentiometer parts.
- SDK `exp_bus`: scan and read against the no-code LM75 example, loaded as a `.dotpart` built by the CLI.

Headless Chrome (`tests/browser/parts.test.mjs`): cross-origin isolated page, strict CSP (`worker-src blob:`), no request outside the test origin, no page error; `parts_io`, `parts_i2c` and `parts_uart` run (the ESP32 sketch in a blob module Worker).

Also done: `dotbench sdk --role kodeos` after the driver changes (see the end of this file for the result).

## Page wiring (for the front-end engineer)

Everything is plain ES modules in `runtime/web-adapter/` (flat, copy the folder). No DOM, no globals.

1. Isolation: the page must be cross-origin isolated (COOP `same-origin`, COEP `require-corp`) as for the device itself. Under a CSP with `worker-src blob:` the part Worker must be a blob:
   ```js
   import { configureWorker } from "./bench-wasm.js";
   configureWorker({ source: await (await fetch("part-worker.js")).text() });   // once, before the first wasm part powers on
   ```
   Without a strict CSP this is not needed (the module Worker is found next to `bench-wasm.js`; `configureWorker({url})` overrides).
2. One bench per page, attached to the device or system object before `start()`:
   ```js
   import { Bench } from "./bench.js";
   const bench = new Bench();                 // realtime clock
   bench.attach(dev);                         // DotbenchDevice or DotbenchSystem; re-attaches itself at every boot
   ```
   `bench.detach()` / `bench.dispose()` on teardown. The bench survives firmware restarts (parts, wires, fields stay).
3. Library: fetch `parts/dist/library.json` (`{format, version, parts:[{id, version, file, bytes, sha256, name{en,pt-BR,es}, category, kind, tags, folder}]}`), then `await bench.loadPart(new Uint8Array(bytes))` per file the user picks (or all). It returns `{ok, errors, manifest, ...}`; show `errors` in the import dialog. `describeDotpart(def)` (from `dotpart.js`) gives what the import dialog shows (name, author, license, pins, size, behaviour kind, permissions).
4. Bench actions the UI calls: `addPart(id, {pos:{x,y,rot}, fields, label})` returns the instance id; `movePart`, `removePart`, `setField(instance, name, value)`, `press(instance, field, ms)`, `connect(termA, termB, {color})` returns the wire id, `disconnect(wireId)`, `restartPart(instance)`, `serialIn(instance, text)` (a part's console input).
5. Terminals are `"<instance>.<pin>"`; the device is `device.EXP1..EXP14`, `device.V33`, `device.V5`, `device.GND`. `DEVICE_TERMINALS` (exported by `bench.js`) lists them with the physical J3 pin numbers (EXP1..7 on pins 3..9, EXP8..14 on pins 12..18, 5V pins 1 and 20, 3V3 pins 2 and 19, GND pins 10 and 11).
6. Render from `bench.state()` (cheap, call on `change`): `{version, t, rails:{V33,V5}, attached, device:{pins[14]:{mode,pull,level,hz,duty,mv,floating,pwm,net,term}}, parts:[{instance, id, label, pos, fields, outputs, kind, power:{on,reason}, visuals:{<visual id>: number}, console[], busy, crashed, pins:{<pin>:{mv,level,floating,pwm,net}}}], wires:[{id,from,to,color,short}], hazards[], events[]}`. `visuals` are already scaled as the manifest's `visuals[].scale` says; the page maps them onto the SVG ids named in the manifest. `controls[]` in the manifest say which `region` of the picture drives which field.
7. Events: `bench.on("change"|"output"|"edge"|"warning"|"hazard"|"part"|"link"|"console"|"log", cb)` returns an unsubscribe. `warning` and `hazard` carry text for the status bar and the wire highlights (`state().wires[].short`).
8. Layout: `bench.serialise(name)` returns the `.dotlayout` object (`format: "dotbench-layout"`, `version: 1`); `await bench.restore(layout)` returns `{missing, dropped, notes}` (parts whose id is not loaded, wires that could not be connected, version differences). Load the library first, restore second.
9. Virtual time (tests, "step" button): `new Bench({clock: new BenchClock({mode: "stepped"})})`, `await bench.advance(us)`. The realtime clock supports `bench.clock.setMode`, `setRate(x)`, `pause()` and `resume()` (see `bench-clock.js`); the page's own speed control can use these.
10. Power: the bench follows the firmware. The 3V3 rail switches on when the app calls `kode_pin_power_3v3(true)`; the 5 V rail follows the PMIC boost bit. `bench.setRails({V33, V5})` is for tests and for an app that never switches the rails.

## What the model cannot represent

- Time on the wire: no per-byte I2C/SPI/UART timing and no virtual-time pacing of a transfer (a transfer is one instant; baud only matters as a match check, 3 % tolerance).
- Analogue behaviour beyond a resistive network: no capacitance, no inductance, no clock stretching, no open-drain edge shapes; levels have hysteresis at 75 % and 25 % of the reader's supply; a net with no source reads 0 mV.
- PWM is a property of the net (`{hz, duty, mvHigh, mvLow}`) and `mv` is the duty average; part visuals evaluate it at solve time, not per cycle.
- Chip select driving is not modelled: an SPI slave sees the bus when SCK, MOSI, MISO (and CS if the part declares it) are on the master's nets.
- Two masters on one bus, multi-drop UART contention, and glitches shorter than a solve.
- Power glitches: a part is on or off at solve time; the 1 ms filter in the design is not implemented.
- Device current limits are only a budget warning (`BUDGET_MA`), not a brown-out.

## Departures from `component-api.md`

1. No SPI slave parts (code or declarative): `dp_spi_slave_event` is in the allow-list and the router handles slave objects, but no built-in part uses it and it is untested end to end.
2. No `power_out` terminals on declarative parts; wasm parts do not drive rails either.
3. The `wireless` element is validated and inert.
4. Declarative parts gained two elements the design did not have, `led` and `buzzer`, so the shipped LED and buzzer are no-code; both are in `manifest.schema.json`.
5. Code-part fields are limited to `number`, `integer`, `boolean`, `enum` (strings are not passed to the Worker).
6. `Preferences` is kept in memory only; it does not survive a reload (documented in the starter).
7. Slave transactions are limited to 256 bytes; there is no inbound ring beyond one CAS slot and no per-part rate limit.
8. Under a strict CSP a blob Worker needs `configureWorker({source})`; this is page wiring the design did not mention.
9. The 3V3 rail with no radio link is derived from the C5 reset (`C5_EN` driven low), which is how the SDK's radio actor switches J3 on without a link; with a link it follows the hosted GPIO 5 event. New exp link word 10 (`v33_pulse`).
10. The push button had a `latch` field in an earlier draft; it did nothing and was removed (the `pressed` field holds the contact).
11. Serial writes of a code part are flushed immediately, not at newline.

## NOT done

- No display part (no cheap faithful model); no motor driver, stepper, relay or other built-ins beyond the eleven above.
- No SPI slave sample part and no SPI end-to-end test with firmware.
- No official Kode modules (Robotics, Maker): the brief puts them after items 1 to 7; they are not started.
- No time-accurate bus model (see above), no power glitch filter, no brown-out.
- The page itself (library browser, wire drawing, inspector, import dialog, Make your own tab) is not built: this branch ships the model and the contract only.
- `.dotlayout` is checked in Node only; there is no browser test of import and export.
- No persistence of the bench between visits (the page owns that: store `serialise()` output).

## Risks

- Timing: the end-to-end and browser tests boot a real firmware per case on a shared 2-core machine. One browser run (`parts_i2c`) failed once right after the end-to-end run and passed in 13 reruns on its own, so it was not reproduced; its wait is 40 s. If it returns, run it alone first.
- The first `dotbench part build` of a code part compiles dotcore (about 21 s) and needs emsdk; later builds use the cache.
- Node takes the `worker_threads` path for parts even though Emscripten defines a global `Worker` there (found and fixed during the end-to-end work).
- `runtime/drivers/parts/area.json` exists only to register the test apps so `tests/node/run.sh` keeps working.

## kodeOS role check

`tools/dotbench sdk --role kodeos` with the new and changed drivers: `340 real SDK files, 324 LVGL files, 132 stub functions`, every group `0 failed`, exit 0. The kodeOS image itself was not rebuilt or booted with a bench attached.
