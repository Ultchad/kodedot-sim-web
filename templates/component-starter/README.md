# dotbench part starter

Make your own component ("part") for the dotbench bench, wire it to the Kode Dot's expansion header, and watch it work. A part can be **no-code** (a button, a potentiometer, an I2C sensor with fixed registers) or **real Arduino code** (an ESP32 that behaves like a sensor, a display controller, anything you can write in an `.ino`).

Other languages: [Português (Brasil)](README.pt-BR.md), [Español](README.es.md). Prefer to let an AI do it? Use [PROMPT.md](PROMPT.md).

## What is in this folder

| File | What it is |
|---|---|
| `manifest.json` | The part's description: name, pins and where they are on the picture, editable fields, behaviour. This starter is an ESP32 acting as an LM75 temperature sensor. |
| `manifest.schema.json` | The JSON Schema `manifest.json` must follow (your editor can use it for hints). |
| `picture.svg` | The part's picture. Replace it with yours (PNG, WebP or SVG, at most 1 MB). |
| `src/main.ino` | The Arduino sketch, real code. |
| `tests/sensor.test.json` | A scenario that checks the part (boot text, an I2C register read, a field change, a NACK). |
| `examples/` | Two finished **no-code** parts to copy from: an LM75 breakout and a push button. |
| `libraries/` | Put Arduino libraries here (copy the library folder). |
| `PROMPT.md` (+ `.pt-BR`, `.es`) | A ready-made prompt for an AI coding assistant. |

You need the `dotbench` command-line tool (the same one that builds Kode Dot apps for the bench; `dotbench part --help` lists the part commands). No-code parts need nothing else.

## Step by step, by hand

1. **Copy this folder** (`dotbench part new my-sensor` does it) and open it in an editor.
2. **Give the part an identity** in `manifest.json`: a unique `id` (for example `com.yourname.my-sensor`, lowercase, dots), `name` and `description` in English, Portuguese and Spanish, your `author`, a `license` (an SPDX id such as `MIT`), and `version`.
3. **Draw the picture.** Open `picture.svg` in a browser, or make a PNG. `picture.width` and `picture.height` in the manifest are the size of the drawing in pixels. Every position in the manifest (`pos`, `region`, `visuals`) uses that pixel box, with (0,0) at the top left.
4. **List the pins.** One entry per place where a wire can attach:
   - `power_in` for the supply (give `min_mv` and `max_mv`, for example 3000 and 3600), `ground` for GND, `io` for a signal, `analog` for an analog signal.
   - `pos` is the centre of the pad on your picture. Open the picture and read the coordinates.
   - For Arduino code, `gpio` is the pin number your sketch uses (`SDA` is 21, `SCL` is 22 on this starter).
   - A part is **off until its power pin is on a rail and its ground pin is wired to GND**. The Kode Dot app must switch the rail on first (`kode_pin_power_3v3(true)`).
5. **Add fields** for anything you want to change while it runs: a temperature slider, an address, a switch. Each has a `name` (lowercase), a label in three languages, a `default`, and limits.
6. **Choose the behaviour.**
   - **No code**: copy `examples/lm75-declarative.manifest.json` or `examples/button-module.manifest.json` and change it. Elements available: `switch`, `bridge`, `divider`, `source`, `drive`, `i2c_slave`, `h_bridge`, `servo`, `wireless`. Values come from your fields.
   - **Arduino code**: edit `src/main.ino`. Read a field with `dotbenchField(FIELD_TEMPERATURE)`, publish a value to the picture with `dotbenchOutput(OUTPUT_READS, n)`. The header `dotbench_fields.h` is generated from your manifest when you build.
7. **Make the picture react** with `visuals` (an LED that glows, a text with a number) and let people poke it with `controls` (a button you can press on the picture).
8. **Check and test.**
   ```
   dotbench part check .     # manifest, picture, pin and field references, translations
   dotbench part test .      # builds your code and runs tests/*.test.json
   ```
   Edit `tests/sensor.test.json` to match your part. Steps: `advance_ms`, `set_field`, `expect_serial`, `i2c`, `expect_output`.
9. **Build the part file:** `dotbench part build .` produces `<id>-<version>.dotpart`.
10. **Try it in the browser.** Open dotbench, tab **Make your own**, drop the `.dotpart` in **Check my part**, read what the import dialog says (what it runs, which pins, what it cannot do), then import it. Add it to the bench, wire `3V3` and `GND`, then the signal pins to the header (`EXP1` to `EXP14`), and run your Kode Dot app.

## Things to know

- **What the Kode Dot can do on the header:** digital in and out, PWM out (1 to 40000 Hz), analog read on `EXP8` to `EXP12` and `EXP14`, I2C **master**, SPI **master**, UART 8N1. It cannot be a slave on I2C or SPI, so your part is the slave.
- **Arduino rules:** write a normal sketch. For an I2C slave use `Wire.begin((uint8_t)address, SDA, SCL, 100000)` (with the cast). Supported: GPIO, interrupts, `analogRead`, PWM (`analogWrite`, `ledc*`), `millis/delay`, `Serial` (shown in the part's console), `Serial1/2`, `Wire`. Not supported: FreeRTOS tasks, WiFi, Bluetooth, SD, NeoPixel and other bit-timed libraries. SPI and `Preferences` are planned.
- **Time is virtual.** `delay()` and `millis()` follow the bench clock, so pausing or stepping the bench pauses your sketch.
- **Libraries:** copy a library folder into `libraries/`. Libraries that touch AVR registers do not work.
- **Limits of the simulation:** signals are DC levels and bus transactions. PWM is frequency and duty, not edges. Bit-banged protocols, I2C clock stretching and current are not simulated.
- **Licence:** your part is yours; choose the `license` honestly and keep the licences of libraries you copy in.
- **Nothing leaves your browser.** A part cannot use the network.

## If something goes wrong

| Message or symptom | Likely cause |
|---|---|
| part stays dark | rail not switched on by the app, `power_in` not wired, or `ground` not wired to GND |
| I2C probe finds nothing | SDA and SCL swapped or wired to different nets than the app's `kode_i2c_begin`; wrong address; the part is off |
| "two outputs on one net" / red wire | two outputs wired together, or an output on a rail |
| "5 V on a 3.3 V pin" | a 5 V rail or a 5 V part driving a 3.3 V pin |
| `check` says a position is outside the picture | `pos` or a region exceeds `picture.width/height` |
| `test` says "undeclared identifier" for a function | add a prototype above its first use |
| "crashed" badge on the part | your code trapped (out of memory, bad pointer); it reboots up to 3 times |
| "busy loop" badge | `loop()` never calls `delay()` or anything blocking |
