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
| Built-in parts (39) | `parts/`, built to `parts/dist/*.dotpart` plus `library.json` (v2: categories, keywords en/pt-BR/es, body, pin count) | works, 377 scenario steps pass in 35 scenario files |
| Nodal solve with time (RC transient, diodes) | `bench-solver.js` `solveNetwork`, `bench.js` `_nodal` | works, `circuit.test.mjs` 43 checks |
| Boards that run sketches, Arduino libraries, code-part contract | `parts/gen/boards.mjs`, `runtime/parts/core/`, `bench.js` | works, `boards.test.mjs` 48 checks |
| `dotcore` (ArduinoCore-API plus Wire, SPI, Preferences, Serial, pins) | `runtime/parts/core/` | cached build under `~/.cache/dotbench/dotcore-<hash>` (cold 21 s) |

### Built-in parts (34)

Everything with a `parts/gen/*.mjs` generator is rewritten by `node parts/gen/gen-parts.mjs`, then `node parts/build-library.mjs` builds `parts/dist` (gitignored). `parts/gen/legacy.mjs` adds body, millimetres and keywords to the eleven hand-written ones. Each part has `tests/*.test.json` scenarios; `build-library` refuses a part without keywords in en, pt-BR and es, a `body`, and an `mm` on every pin.

| Part | Id | What it models | What it does not |
|---|---|---|---|
| Resistor | `resistor` | any value (field `ohms`), current and power, overpower hazard (field `watts`) | tolerance, noise |
| Ceramic capacitor | `capacitor-ceramic` | C and ESR, real charge and discharge in virtual time | leakage, voltage rating |
| Electrolytic capacitor | `capacitor-electrolytic` | the same, plus polarity: reverse above 1 V for 40 ms bursts it (`burst` output, latched until `repairPart`) | venting energy, ESR drift |
| Diode | `diode` | piecewise linear, knee 0.7 V, series resistance, reverse blocking | reverse recovery, breakdown |
| LEDs red, green, yellow, blue, white | `led-*` | knee per colour, brightness output, `overcurrent`, and `burnt` after 60 ms above the rating (latched, `repairPart`) | colour shift, thermal |
| 9 V battery | `battery-9v` | EMF with internal resistance | discharge curve |
| Supply 5 V / 3.3 V | `supply` | adjustable voltage source, `current_ma` output | current limit |
| Breadboard half / full | `breadboard-half` (400 tie points), `-full` (830) | real internal connections: strips of five (a-e, f-j per column), power rails | capacitance, rail breaks |
| DC motor | `dc-motor` | winding resistance, `speed` and `direction` outputs | back-EMF, inertia, inductive kick |
| L298N module | `l298n` | two half bridges, enables, VS/VSS, logic threshold | current sense, regulator; each output has a 1.4 V drop |
| 28BYJ-48 + ULN2003 | `stepper-28byj48` | 8-phase half-step decode from IN1..IN4, `position` (half steps), `angle`, `stalled` above 1000 steps/s | torque |
| NEMA 17 + A4988 | `stepper-a4988` | STEP edges counted at their exact virtual time, DIR, MS1..3 microstep, EN, RST, SLP, `position` (1/16 steps), `stalled` | coil current, resonance |
| Relay module | `relay-module` | active low or high, 8 ms contact time, COM-NC at rest even unpowered | ratings, arc, mains safety |
| Antenna | `antenna` | an SMA stub: a 1 Gohm open circuit at DC with `band` and `gain_dbi` fields | radiation, VSWR, range (range is the distance on the table) |
| Servo | `servo` | follows the pulse width exactly as the Arduino Servo library sends it: 544 us is 0 degrees, 2400 us is 180 (was 1000 to 2000; `Servo.write(90)` now reads 90) | speed limit |
| Arduino Uno R3 | `uno-r3` | 5 V logic, D0-D13 + A0-A5 (10 bit), PWM pins 3 5 6 9 10 11 (490/980 Hz), I2C A4/A5 (also SDA/SCL header pins), SPI D10-D13, Serial + Serial on D0/D1, interrupts D2 D3, EEPROM 1 KB, 3V3 output, USB (field `usb`) or 5V/VIN supply, input threshold 60 % (a 3.3 V Dot reads high) | the chip |
| Uno R4 Minima | `uno-r4-minima` | the Uno header, 14 bit ADC (`analogReadResolution`), 12 bit DAC on A0, Serial1 on D0/D1, EEPROM 8 KB, 75 % input threshold | the chip, CAN |
| Uno R4 WiFi | `uno-r4-wifi` | R4 Minima plus the 12 x 8 LED matrix as outputs `matrix0..2` and a WiFi that is NOT connected | matrix sequences, text, the radio |
| ESP32-S3 DevKitC-1 | `esp32-s3-devkitc` | two 22 pin headers, LEDC PWM on any GPIO, 12 bit ADC on GPIO1-20, touch/I2C/SPI/UART capabilities, RGB LED GPIO48 as one LED | USB pins, PSRAM, radios |
| ESP32 (3 boards) | `esp32-blink-echo`, `esp32-button-led`, `esp32-i2c-slave` | as before, now with body and millimetres | |
| LED + resistor, RGB LED, push button, slide switch, potentiometer, buzzer, HDC1080 | as before | | |

**No board emulates its chip.** A board part is a wasm part: the sketch is compiled to WebAssembly against ArduinoCore-API + dotcore for that board's variant. Pins, voltages, the Arduino API and time in milliseconds are real; AVR, Renesas and Xtensa instructions are not, there are no registers (`PORTB`, `DDRB`, `TCCR1A`, `digitalPinToPort` do not exist), `int` is 32 bit (it is 16 bit on a real Uno), and `__AVR__` is not defined. Every board manifest says so in its description.

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

### Page wiring, additions (time, groups, geometry, code parts)

11. **Library index v2**: `{format, version: 2, categories[], parts:[{id, version, file, bytes, sha256, name, category, kind, tags, keywords:{en,pt-BR,es}, description, body, pins, core?, folder}]}`. Categories used: `passive`, `power`, `prototyping`, `actuator`, `input`, `sensor`, `mcu`, `wireless`. Search the keywords of the user's language and the names.
12. **Geometry (one convention for every part)**: millimetres, origin at the top-left corner of the footprint seen from above, x to the right, y down the picture, z up from the table. `body: {w_mm, d_mm, h_mm}`; each pin has `mm: {x, y, z?}` (the contact point; z defaults to the face's own height: top = `h_mm`, bottom = 0) and `face`: `top` (sockets, screw terminals), `bottom` (leads that plug into a breadboard), `left`/`right` (x edges), `front` (y = d_mm), `back` (y = 0). The `picture.svg` is the same top view drawn at `picture.width / body.w_mm` pixels per mm, and the pin `pos` (pixels) equals `mm` times that scale. Pitch is 2.54 mm wherever the real part has it. Header positions of the Uno family follow the Arduino R3 drawing to the nearest pin, verify against the drawing before printing an enclosure.
13. **Internally connected terminal groups**: `manifest.groups: [{pins: [A, B, ...]}]`. Pins of a group are one net (a breadboard column strip, the three GND pins of an Uno, A4 and the SDA header pin). `bench.state().groups` is not needed: read `parts[].pins[<pin>].net`; two pins of a group always share the id. The breadboard pins are `a1..j30` (half) or `a1..j63` (full) and the rails `T1_n T2_n B1_n B2_n` (n up to 25 half, 50 full).
14. **Part state fields to animate** (in `state().parts[].outputs` and `visuals`): LEDs `brightness` 0..1, `current_ma`, `overcurrent`, `burnt`; electrolytic `burst`; motor `speed` (-1..1) and `direction`; steppers `position`, `angle`, `stalled`; relay `energized`, `closed`; servo `angle`; buzzer `hz`; Uno R4 WiFi `matrix0..2` (96 pixels in three 32 bit words, bit 31 of word 0 is the top-left LED, row by row, 12 per row); capacitors `volts_mv`; resistor, supply `current_ma`; L298N `out1..out4`.
15. **Hazards**: `bench.on("hazard")` and `state().hazards[]` now also carry classes `overcurrent`, `overpower`, `polarity`, `burnt`, `overvoltage`, `short`, `contention`, `budget`. `bench.repairPart(instance)` clears a burnt LED or a burst capacitor ("replace the part").
16. **Time in the solver**: the bench solves a nodal network (modified nodal analysis, backward Euler for capacitors) whenever a capacitor is present or a part declares a nonlinear branch; the per-net Thevenin solve stays the DC fast path, so a bench with no capacitor and no diode costs what it did. Capacitor voltages advance on the bench clock (200 us steps on the stepped clock, 1 ms realtime, growing to 20 ms as it settles; it stops when nothing moves), so an RC charge takes the right virtual time. `bench.batch(fn)` defers solves, `restore()` uses it.
17. **Code parts** (a board carries its own sketch): `bench.getPartCode(instance)` returns `{source, wasm, sha256, name, custom}`; `await bench.setPartCode(instance, {source, wasm, name})` is the "Compile and upload" call: it checks the binary against the ABI 1 allow-list (throws on anything else), keeps wiring, position, fields and EEPROM, restarts only that part, clears its serial monitor and starts the new binary; `await bench.clearPartCode(instance)` goes back to the package's sketch. `bench.serialLog(instance)` returns the monitor lines, the `console` event delivers each new line (`{instance, line, t}`), `bench.serialIn(instance, text)` types into it. `serialise()` adds `code: {source, wasm_b64, sha256, name}` and `storage_b64` (EEPROM bytes) per part that has them; `restore()` re-applies both. The wasm may come from `dotbench part build` or from the in-browser compiler: only the ABI 1 allow-list matters. The default sketch of a board is `parts/<board>/src/main.ino`.
18. **Board variants as data, one folder per board**: pin map, capabilities (`caps`), logic voltage (`logic_mv`), input threshold (`vih_pct`), supply groups and the default sketch are the manifest and `src/main.ino` in `parts/uno-r3/`, `uno-r4-minima/`, `uno-r4-wifi/`, `esp32-s3-devkitc/` (and the three `esp32-*`). The compile side (offline `part build`, in-browser compiler) reads `behaviour.core` (`esp32`, `esp32-s3`, `uno-r3`, `uno-r4-minima`, `uno-r4-wifi`) and the matching `runtime/parts/core/variants/<core>/pins_arduino.h` (ADC and PWM resolution, PWM and interrupt pins, EEPROM size, `LED_BUILTIN`, `SDA SCL SS MOSI MISO SCK`). Per-core defines are in `CORES` in `tools/dblib/part/build.mjs`.
19. **Powering a board**: field `usb` (default on) drives the 5V pin at 5 V and makes GND a 0 V reference; with it off, power the board on `5V` (4.5 to 5.5 V) or `VIN` (a supply group: either one runs it). Limit: from `VIN` alone the on-board regulator does not feed the `5V` pin in this model; the 3V3 pin is an output while the board is powered.

### Kode modules (official add-ons on J3)

Spec: `/home/claude/research/06-official-modules-spec.md` (every fact sourced or marked). Tables are data in `parts/gen/data/modules.json`; edit it and run `node parts/gen/gen-parts.mjs` to correct a mapping (no code change). Library category `kode-module` ("Kode modules"), keywords in en, pt-BR and es. Test: `tests/node/parts/modules.test.mjs` (32 checks) including `apps/parts_robotics`, an app of our own that drives two DC motor parts and a servo part through the module.

**Attach mechanism**: manifest `mount: {via: "direct"|"interposer", orientations, pins:[{pin, gpio, source}], rails:[{pin, rail}]}`. `bench.mountPart(instance, "upright"|"turned")` joins every listed pin to its header position and every rail pin to V5, V33 or GND in one action (turned: position p becomes 15 - p, rails stay; the GPIO of each position is `J3_GPIO` in `bench.js`); only one module at a time (a second one throws); an interposer module cannot be turned; `unmountPart`, `mounted()`; `state().parts[].mount = {orientation} | null`; `serialise()` and `restore()` keep it. `bench.setUsbPower(true)` keeps the 5 V rail present whatever the firmware does with the boost bit (the bench rail otherwise follows the boost bit, which an app on USB never sets). Pass-through terminals are the module's own pins (Maker sockets, Robotics J402, J403, J404 pins, tied by `groups`).

| Module | Id | What works | Not modelled / assumed |
|---|---|---|---|
| Maker | `kode-maker` | 14 sockets S1..S14 with the corrected order (9 to 14 are GPIO20, 19, 18, 17, 16, 15), four 5 V, four 3.3 V and two groups of four GND sockets, a 170 point breadboard (a1..j17, strips of five), overvoltage hazard when 5 V meets a socket, upright and turned | no pull-ups (as the real one); size 58 x 52 mm and all terminal positions are ESTIMATES (picture, `body.estimate`), only the breadboard (45.5 x 34.5 mm) is documented |
| Robotics | `kode-robotics` | AT8833CQ as four half bridges from the 5 V rail, nSLEEP gates them (asleep: high impedance), 20 kHz PWM average, two motor outputs and the stepper header, servo J402 (GPIO11, 5 V), I2C port J403 with 2.2 kohm pull-ups to 3.3 V, sensor header J404, nFAULT pull-up, upright and turned | ASSUMED: AT8833CQ behaves as a DRV8833 (AIN1 to AOUT1 ..., 0.3 V drop, 0.4 ohm), stepper header pin order, nFAULT pull-up rail (3.3 V), 100 kohm input pull-downs. NOT modelled: the 0.4 A current chop and 2.2 to 3 A trip (nFAULT never asserts), servo timing limits, the seven identification lines. The GPIO table itself is documented. Dimensions are estimates |
| Camera, Mesh, hacking module | `kode-camera-shape`, `kode-mesh-shape`, `kode-hacking-shape` | SHAPE ONLY: they mount (Mesh and hacking through the interposer, upright only), pass rails and the 14 documented signal terminals through, and do nothing else | everything: no OV5640, no LR2021, no GNSS, no CC1101, no nRF54L15, no C5 |

**Module bodies and placement (item 8 fix)**. Every module carries the real 2x10 mating connector, 2.54 mm in both directions: 20 pins named as before (the function names) plus the rail pins `V5`/`V5_2`, `V33`/`V33_2`, `GND`/`GND_2`; each has `ref` ("J401.17", "KDINT.5" for the interposer) and a `mm` with `z`. Maker has no function names, so its 20 connector pins are `J401_1..J401_20` (new terminals, wired on the board to the sockets S1..S14 and the strips; the socket names are unchanged). Terminal names that exist and did not change: everything else. New terminals: the second rail pins, Maker's `J401_n`. No bench behaviour changed: header position p, turned 15 - p. The truth: the Dot's J3 is 2x10 (pins 1, 20 = 5 V; 2, 19 = 3.3 V; 10, 11 = GND; 3..9 = positions 1..7; 12..18 = positions 8..14); a right-angle J401 module meets it mirrored (module pin 20 - m for odd m, 22 - m for even m, derived, consistent with the published tables), the interposer modules straight (pin n = header pin n). Mount pins in the manifest list the 14 GPIO pins and 6 rail pins: all 20 connector positions are terminals, no signal falls off.

Bodies are the bounding box of everything the model draws: the flat modules include the 8 mm of pins past the board edge (body d = board d + 8; Camera 45.5 + 8, Maker and Robotics 52 + 8 mm, Maker 14 mm high); Mesh and the hacking module (shape only) are 50 x 24 x 91 mm INCLUDING the two antennas (about 21 and 41 mm tall, `refs` SMA1, SMA2: non-electrical reference points with `length_mm`, at z = body top of the block, 50 mm). Housing estimate from ref-4..8 against the Dot's 46.65 mm width and the 2.54 mm pitch: block 50 mm wide (a little wider than the Dot), 16 mm thick; tongue 3 mm thick, 34 mm below the block's underside to z = 0; pins point down (-z) 6 mm from the underside, in the row middle y = 12.9 (tongue + half of the Dot's 19.8 mm depth). All of it `body.estimate`.

What the page needs to place a mounted module in 3D: the Dot's frame is X right, Y up, Z out of the screen, origin the centre of its 46.65 x 77.0 x 19.8 mm box (web/public/device/MODEL.md); its connector is in the top wall (Y = +38.5), centred (assumed). `mount.placement.anchor_dot_mm` is that point; `mount.connector.seat_mm` is the same point in the part's own frame (x right, y down, z up, origin the top-left of the footprint on the table, so a LEFT-handed frame: map component by component, det -1, do not feed it to a rotation quaternion). The part point seat_mm lands on anchor_dot_mm and the part axes point as `mount.placement.upright` (or `turned`, a half turn about the Dot's Y): flat modules (Maker, Robotics, Camera) stand on the top edge as a vertical board parallel to the Dot's back, pins down into the top wall, component side facing the back for upright (x -> -X, y -> -Y, z -> -Z) and the screen side for turned (x -> +X, y -> -Y, z -> +Z); Mesh and the hacking module (interposer, upright only) have the tongue against the back of the Dot and the block on its top edge (x -> +X, y -> +Z, z -> +Y), as in the owner's photos (ref-5, ref-8). Assumed: the connector's centring on the Dot, which row of the Dot is pin 1's (assumed the front row; `connector.odd_row`), that flat modules face the back when upright (no mounted photo of them), the z of the two pin rows (2.87 and 5.41 mm above a 1.6 mm board), the pin length (8 flat, 6 standing).

Robotics layout now follows the photo: motor B, stepper header, motor A left to right on the top edge (the pin order inside each is assumed), servo header J402 below the corner hole on the left edge, J403 under it, J404 on the right edge with GND at the top and 3V3 at the bottom; picture and manifest agree.

Decision on Camera, Mesh and the hacking module: they are in the library as clearly labelled shape-only entries ("(shape only)" in the name, "SHAPE ONLY" first in the description in 3 languages, tag `shape-only`) because the pin maps are documented and a 3D scene can show the module on the Dot; the behaviour is not built because their SDKs are private, the schematics are missing and the spec rates them high to very high difficulty. They never fake a function: nothing answers on any bus. Dock (KDBAS001) and the interposer as a separate part are not built (the interposer is the `via: "interposer"` mount).

### dotcore libraries (what a sketch can use)

`Servo` (50 Hz PWM, 544 to 2400 us like the library), `Wire` (master and slave), `SPI` (master), `Stepper` (2 and 4 wire, same sequences), `tone` and `noTone` (with duration, stops by itself), `analogRead` and `analogWrite` with each board's resolution and PWM pins (a non-PWM pin goes digital, as on the board), `attachInterrupt` (Uno R3 only on D2 and D3, other boards every pin), `Serial` and `Serial1`, `EEPROM` (per part instance, kept with the layout and across restart and "upload"; AVR and R4 write through, the ESP32 variants need `begin` and `commit` like the real one; 8 KB bench-wide), `String`, `itoa` family, `dtostrf`, `avr/pgmspace.h` shims, `Arduino_LED_Matrix` (R4 WiFi), `Preferences` (ESP32, in memory). **WiFi, WiFiClient, WiFiServer, WiFiS3 are not connected on purpose**: `begin()` leaves the radio disconnected, `status()` is `WL_DISCONNECTED`, `connect()` returns 0, a scan finds nothing, and the bench gets one `warning` ("WiFi is not simulated ..."). Decision: the simulator's router objects belong to the Dot's own radio area and are not reachable from a part's sandbox without a new ABI call; faking success would make sketches look right that cannot work. Two ABI 1 names that were reserved are now implemented: `nvs_get(off, ptr, n)` and `nvs_set(off, ptr, n)` (persistent bytes of the instance) and `log(ptr, n)` (a note for the bench).

## What the model cannot represent

- Time on the wire: no per-byte I2C/SPI/UART timing and no virtual-time pacing of a transfer (a transfer is one instant; baud only matters as a match check, 3 % tolerance).
- Analogue behaviour: resistors, capacitors (RC transient), diodes and LEDs are solved; there are **no inductors** (a motor has no back-EMF or kick, a relay no coil spike), no transmission lines, no clock stretching, no open-drain edge shapes, and **it is not SPICE** (fixed-step backward Euler, piecewise linear diodes, dense Gaussian elimination, meant for small benches). Levels have hysteresis at 75 % and 25 % of the reader's supply (`vih_pct` per part); a net with no source reads 0 mV. A capacitor on a PWM net sees the duty average, so it is a perfect filter. Grounds are ideal: there is no common-ground check. `rth` of a net is approximate when capacitors are present. A resistor or LED on a Dot pin goes through the per-net approximation of the older `led` element when no nodal element is on the net.
- Edges inside one solve: the exact time of each edge is kept for wasm parts (A4988 STEP counting); edges of the Dot's own pins that collapse inside one solve can be lost.
- PWM is a property of the net (`{hz, duty, mvHigh, mvLow}`) and `mv` is the duty average; part visuals evaluate it at solve time, not per cycle.
- Chip select driving is not modelled: an SPI slave sees the bus when SCK, MOSI, MISO (and CS if the part declares it) are on the master's nets.
- Two masters on one bus, multi-drop UART contention, and glitches shorter than a solve.
- Power glitches: a part is on or off at solve time; the 1 ms filter in the design is not implemented.
- Device current limits are only a budget warning (`BUDGET_MA`), not a brown-out.

## Departures from `component-api.md`

1. No SPI slave parts (code or declarative): `dp_spi_slave_event` is in the allow-list and the router handles slave objects, but no built-in part uses it and it is untested end to end.
2. `power_out` terminals now work on parts: a pin with `out_mv` is a source while the part is powered (3V3 of the boards, IOREF); `internal` makes a pin a source from the part's own supply (a board on USB).
3. The `wireless` element is validated and inert.
4. Declarative parts gained two elements the design did not have, `led` and `buzzer`, so the shipped LED and buzzer are no-code; both are in `manifest.schema.json`.
5. Code-part fields are limited to `number`, `integer`, `boolean`, `enum` (strings are not passed to the Worker).
6. `Preferences` is kept in memory only; it does not survive a reload (documented in the starter). `EEPROM` does persist (see item 17).
7. Slave transactions are limited to 256 bytes; there is no inbound ring beyond one CAS slot and no per-part rate limit.
8. Under a strict CSP a blob Worker needs `configureWorker({source})`; this is page wiring the design did not mention.
9. The 3V3 rail with no radio link is derived from the C5 reset (`C5_EN` driven low), which is how the SDK's radio actor switches J3 on without a link; with a link it follows the hosted GPIO 5 event. New exp link word 10 (`v33_pulse`).
10. The push button had a `latch` field in an earlier draft; it did nothing and was removed (the `pressed` field holds the contact).
11. Serial writes of a code part are flushed immediately, not at newline.

## NOT done

- No display part (no cheap faithful model). No inductors, no SPICE. No 3D models: the page and other engineers build them from the `body` and `mm` data.
- Boards: no chip emulation (by design), the Uno R4 WiFi matrix has no sequences or text, no Bluetooth, no USB device behaviour, `Serial` on D0/D1 of the Uno does not mirror the USB console, VIN does not feed the 5V pin.
- Libraries: no real WiFi, no `Ethernet`, `SoftwareSerial`, `Servo` on more than the PWM-per-pin model (no timers shared), no `Wire` clock stretching, no SPI slave.
- No SPI slave sample part and no SPI end-to-end test with firmware.
- Kode modules: Camera, Mesh and the hacking module are shape only (see above); no Dock. The Robotics driver truth table and part of its pin table are assumed, and every module size is an estimate.
- The page itself (library browser, wire drawing, inspector, import dialog, Make your own tab, code editor) is not built: this branch ships the model and the contract only.
- The browser check gained one case (Uno R3 in a blob Worker, serial monitor, `getPartCode`, layout) and passes with the other four: `node tests/browser/parts.test.mjs`. Upload through `setPartCode` and EEPROM persistence are covered in Node only.
- `.dotlayout` is checked in Node only; the browser has no test of import and export.

## Risks

- Timing: the end-to-end and browser tests boot a real firmware per case on a shared 2-core machine. One browser run (`parts_i2c`) failed once right after the end-to-end run and passed in 13 reruns on its own, so it was not reproduced; its wait is 40 s. If it returns, run it alone first.
- The first `dotbench part build` of a code part compiles dotcore (about 21 s) and needs emsdk; later builds use the cache.
- Node takes the `worker_threads` path for parts even though Emscripten defines a global `Worker` there (found and fixed during the end-to-end work).
- `runtime/drivers/parts/area.json` exists only to register the test apps so `tests/node/run.sh` keeps working.

## kodeOS role check

`tools/dotbench sdk --role kodeos` with the new and changed drivers: `340 real SDK files, 324 LVGL files, 132 stub functions`, every group `0 failed`, exit 0. The kodeOS image itself was not rebuilt or booted with a bench attached.
