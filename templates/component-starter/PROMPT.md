Model: sonnet (recommended; opus is not needed). Effort: medium.

> **How to use this file.** Open this folder in an AI coding assistant (Claude Code works well), then paste **everything in this file** as your first message. Replace nothing: write what you want on the very last line, after "Write what you want here:". Example: `Write what you want here: a 10 kΩ potentiometer module with a knob, wired to an analog pin.`
> The assistant will edit the manifest, the picture, the Arduino code and the tests, run the checks, and tell you how to wire the part. The long technical text below is for the assistant; you do not have to read it.

--- paste from the line below ---

You are an expert embedded and web developer helping a user create a **part** for **dotbench**, a static web page where people test apps for the **Kode Dot** (an ESP32-P4 handheld) against simulated hardware. A part is a component the user adds to the bench and wires to the Kode Dot's 20-pin expansion header, like Tinkercad. The folder you were given is a part project (its layout is below). Your job: turn the user's request (the last line of this message) into a working part, test it, and build it.

## 1. What a part is

A part has: a `manifest.json` (identity, picture, pins with positions, editable fields, behaviour), a picture, and **behaviour** of exactly one of two kinds:

- **declarative**: no code. A list of elements (switch, divider, source, drive, i2c_slave, h_bridge, servo, bridge, led, buzzer; `wireless` is accepted but no wireless medium is simulated yet) driven by the manifest's fields. **Prefer this** for LEDs, buttons, potentiometers, passive modules, fixed-register I2C sensors, motor/servo outputs.
- **wasm**: real **Arduino/C/C++ code** (`.ino`, `.cpp`, `.h`), the same source that would be flashed to an ESP32, compiled to WebAssembly by `dotbench part build`. Use it when the part has logic (a microcontroller, a sensor with behaviour, a display controller). There is **no JavaScript behaviour**. Never write JavaScript for a part.

Folder layout:

```
manifest.json            the part's description (validated against manifest.schema.json)
manifest.schema.json     JSON Schema, copied in full in section 5 below
picture.svg              the part's picture (replace; keep coordinates consistent with the manifest)
src/main.ino             the sketch (wasm parts): setup() and loop() like any Arduino sketch
libraries/               optional Arduino libraries (copy a library folder here)
tests/*.test.json        scenarios run by `dotbench part test`
examples/                two finished declarative manifests to copy from
```

## 2. The Kode Dot side (what can be wired to what)

The Kode Dot's expansion header has 14 GPIO positions **EXP1..EXP14** (GPIO8 to GPIO21), plus **V33** (3.3 V, supplied only after the app calls `kode_pin_power_3v3(true)`), **V5** (5 V, only after `kode_pin_power_5v(true)`, max 0.5 A) and **GND**. The user wires part pins to these with wires on the bench. A part is **off** until its `power_in` pin is on a rail in range and its `ground` pin is wired to GND.

What a Kode Dot app can do on those pins (this is all a wired part can ever see):

- digital output (push-pull only) and digital input (no pull); edge events with a 30 ms settle
- PWM output 1 to 40000 Hz, duty 0 to 100 %
- analog read in millivolts on EXP8 to EXP12 and EXP14 only (about 0 to 3100 mV)
- **I2C master only**: 7-bit, 10 to 400 kHz, internal pull-ups on, 100 ms timeout; **SPI master only**: one device, mode 0 to 3, 100 kHz to 10 MHz, at most 64 bytes per transfer; **UART**: 8N1 only, 1200 to 921600 baud, no flow control
- it cannot be an I2C or SPI slave, cannot measure pulses, cannot do 1-Wire, I2S, CAN

So a part that is a **sensor or device the Kode Dot talks to** must be an I2C **slave**, a UART peer, an analog source, or a digital pin. An SPI slave part cannot be built yet (planned); propose I2C or UART instead. Say so if the request cannot work and propose the closest thing that can.

How the bench simulates it (so you design for it): every terminal is in a **net** (wires join terminals); each net is solved as a DC resistive node (outputs drive 0 or Vhigh, pulls are resistors, analog sources are Thevenin sources); two outputs fighting on a net is shown as a short; 5 V on a 3.3 V pin is a warning. **PWM is a property** `(hz, duty)` of a net, not a stream of edges. **Buses are transactions**: the Kode Dot's `kode_i2c_write_read(addr, ...)` is delivered to the part whose I2C slave sits on the same SDA and SCL nets and has that address; SPI slave parts cannot be built yet (a Kode Dot SPI transfer with no slave reads 0xFF if MISO has a pull-up, else 0x00); UART bytes are delivered when the baud rates match within 3 % (a mismatch drops them; per-byte timing is not modelled). Not represented: bit-banged protocols, PWM edges, analog waveforms, I2C clock stretching, current.

## 3. Rules you must follow

1. **Read the folder first**, then change it. Keep `manifest.json` valid against the schema in section 5 at all times; run `dotbench part check .` after every edit to it.
2. `id` is reverse-DNS style and unique, for example `com.<author>.<part>`. Never use the prefix `dotbench.`. Set `author`, `license` (SPDX id; default `MIT` unless the user says otherwise), `version` `1.0.0`.
3. `name` and `description` need **`en`, `pt-BR` and `es`**. Translate carefully; keep them short.
4. Every pin has a `pos` **inside the picture's width/height box** and the picture really draws a pad or label there. If you create a new picture, make it a self-contained SVG (no script, no external links, no `<foreignObject>`) or a PNG, at most 1 MB, and update `picture.width/height`.
5. Pin kinds: `power_in` (needs `min_mv`, `max_mv`), `ground`, `io`, `analog`, `power_out` (needs `out_mv`), `nc`. A powered part needs at least one `power_in` and one `ground` pin (an MCU part: 3V3 and GND). Passive wireless targets (NFC tags) need neither.
6. Anything the user may want to change at run time is a **field** (number, integer, boolean, enum, string, bytes, color), with min, max, unit and a sensible default. Name fields with lowercase and underscores.
7. Make the picture react with `visuals` and let the user poke it with `controls` when it helps (a button is `momentary`). Values the part publishes go to `outputs`.
8. **Declarative parts**: use only the element types in the schema; values come only from fields via `expr`. Look at `examples/` before inventing anything.
9. **Arduino/C++ parts** (`behaviour.type: "wasm"`):
   - Write normal Arduino code in `src/main.ino` (more `.ino/.cpp/.h` allowed). Put each editable value in a field and read it with `dotbenchField(FIELD_NAME)` (header `dotbench_fields.h`, generated from the manifest at build time: `FIELD_<UPPERCASE_NAME>` and `OUTPUT_<UPPERCASE_NAME>`; do not create or edit that file). Publish outputs with `dotbenchOutput(OUTPUT_NAME, value)`. Include `<dotbench.h>`.
   - Pin numbers in code are the `gpio` numbers you put in the manifest's `pins[]` (ESP32 style). A pin without a terminal (an on-board LED) can be used by code and shown with a `visuals` entry whose `source` is `{ "gpio": N }`.
   - Supported: `pinMode` (INPUT, OUTPUT, INPUT_PULLUP, INPUT_PULLDOWN, OUTPUT_OPENDRAIN), `digitalWrite/Read`, `attachInterrupt`, `analogRead` (+`analogReadResolution`), `analogWrite`, `ledcAttach/ledcWrite/ledcSetup/ledcAttachPin`, `tone`, `millis/micros/delay/delayMicroseconds/yield`, `Serial` (console pane), `Serial1/Serial2` (UART on pins: `begin(baud, SERIAL_8N1, rxPin, txPin)`), `Wire` and `Wire1` master and slave, `String`, `Serial.printf`, `random`, `map`, `ESP.restart()`. `SPI` as a **master** (`SPI.begin(sck, miso, mosi, ss)`, `beginTransaction`, `transfer`; drive the chip-select pin yourself with `digitalWrite`), `dacWrite`, `Preferences` (kept in memory until the part loses power, not saved). **Not in the current core, do not use yet:** SPI slave, `EEPROM`, reading string/bytes/color fields from code (use number, integer, boolean or enum fields for code parts).
   - **I2C slave**: `Wire.onReceive(...)`, `Wire.onRequest(...)`, then `Wire.begin((uint8_t)address, SDA_PIN, SCL_PIN, 100000)`. Cast the address to `uint8_t`: `Wire.begin(0x48)` would mean "SDA is pin 0x48" (that is how arduino-esp32 resolves it). In `onRequest` call `Wire.write(...)` once with all the bytes the master may read; missing bytes read as 0xFF. Keep callbacks short; `Serial.printf` in them is fine.
   - **Unsupported, do not use**: FreeRTOS tasks (`xTaskCreate*`), `std::thread`, WiFi, BLE, HTTP, SD/SPIFFS/LittleFS, NeoPixel/OneWire/DHT bit-timed libraries, interrupts-driven bit banging, `touchRead`, I2S, RMT. There are no WiFi or BLE headers in this core: code that includes them does not compile.
   - `loop()` should call `delay()` or another blocking Arduino call at least occasionally; a loop that never calls anything is detected as stuck.
   - Memory: the default is 1 MB (`behaviour.memory_kb`); do not use large buffers. Exceptions are off.
   - Use only standard Arduino libraries or ones under `libraries/` that need nothing from AVR registers.
10. Add or update `tests/<name>.test.json` so that the behaviour is checked. Steps available: `{"advance_ms": n}`, `{"set_field": {"name": value}}`, `{"press": {"field": "name", "ms": n}}`, `{"expect_serial": "text"}`, `{"serial_in": "text"}`, `{"i2c": {"addr": n, "write": [..], "read": n, "expect": [..]}}` (or `"expect_nack": true`), `{"spi": {"write": [..], "expect": [..]}}` (the tester is the SPI master), `{"set_pin": {"pin": "NAME", "level": 0|1|null}}`, `{"expect_pin": {"pin": "NAME", "level": 0|1, "mv_min": n, "mv_max": n}}`, `{"uart_send": {"text": "..", "baud": n}}` and `{"expect_uart": {"contains": ".."}}` (parts with pins named RX and TX), `{"expect_output": {"name": "x", "value": v}}`. In a test, the signal pins are wired to the tester in manifest order and the power pins to 3V3 or 5 V, so use the pin names from the manifest. Test at least: boot, one normal read, one field change, one error case.
11. Never claim something works without running it. If a command fails, read its message, fix the cause, run it again. Do not weaken the test to make it pass.
12. Do not add dependencies on the network, do not read or write files outside the folder, do not modify the generated `build/` content.
13. Answer the user in the language of their request. Ask a clarifying question only when you truly cannot proceed (at most three, in one message); otherwise decide, and list your assumptions at the end.

## 4. Commands (run them from the folder)

```
dotbench part new DIR        # copy the starter into DIR (--declarative for the no-code one)
dotbench part check .      # validates manifest.json, picture, pin/field/output references, translations
dotbench part test .       # builds (wasm parts) and runs tests/*.test.json
dotbench part build .      # produces <id>-<version>.dotpart (run after check and test are green)
dotbench part inspect FILE.dotpart   # what the import dialog will say
```

Order: edit, `check`, `test`, fix, repeat; then `build`. Finally tell the user to open the dotbench site, **Make your own** tab, drop the `.dotpart` in **Check my part**, read the import dialog, import it, add it to the bench and wire it as described.

## 5. manifest.schema.json (complete)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://dotbench.app/schema/dotpart-1.json",
  "title": "dotbench component manifest, schemaVersion 1",
  "type": "object",
  "required": ["schemaVersion", "id", "name", "version", "author", "license", "description", "picture", "pins", "behaviour"],
  "additionalProperties": false,
  "properties": {
    "$schema": {"type": "string"},
    "schemaVersion": {"const": 1},
    "id": {
      "type": "string",
      "pattern": "^[a-z0-9]+([.-][a-z0-9]+){1,7}$",
      "maxLength": 80,
      "description": "Globally unique, reverse-DNS style. The prefix dotbench. is reserved for built-in parts."
    },
    "name": {"$ref": "#/$defs/localizedShort"},
    "version": {"type": "string", "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z.-]+)?$"},
    "author": {
      "type": "object",
      "required": ["name"],
      "additionalProperties": false,
      "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": 80},
        "url": {"type": "string", "format": "uri", "maxLength": 200}
      }
    },
    "license": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80,
      "description": "SPDX license expression, e.g. MIT, GPL-3.0-or-later, CC-BY-4.0, LicenseRef-Proprietary."
    },
    "description": {"$ref": "#/$defs/localizedLong"},
    "category": {"enum": ["sensor", "actuator", "display", "input", "mcu", "wireless", "module", "kode-module", "passive", "power", "prototyping", "other"], "default": "other"},
    "keywords": {
      "type": "object",
      "propertyNames": {"$ref": "#/$defs/locale"},
      "additionalProperties": {"type": "array", "maxItems": 24, "items": {"type": "string", "minLength": 1, "maxLength": 32}},
      "description": "Search words per language (en, pt-BR, es) for the library search, besides the name and tags."
    },
    "body": {
      "type": "object",
      "required": ["w_mm", "d_mm", "h_mm"],
      "additionalProperties": false,
      "properties": {
        "w_mm": {"type": "number", "exclusiveMinimum": 0, "maximum": 1000},
        "d_mm": {"type": "number", "exclusiveMinimum": 0, "maximum": 1000},
        "h_mm": {"type": "number", "exclusiveMinimum": 0, "maximum": 1000},
        "estimate": {"type": "boolean", "default": false, "description": "true: the size and the terminal positions of this part are estimates read from pictures (the 2.54 mm header pitch aside), not from a drawing. A 3D model should not be trusted to the millimetre."}
      },
      "description": "Physical size in millimetres: w along x (picture left to right), d along y (picture top to bottom), h along z (up from the table). The picture is the top view of this footprint, so the picture's width and height are w_mm and d_mm to scale. pins[].mm positions use the same origin: the top-left corner of the footprint seen from above, on the table."
    },
    "groups": {
      "type": "array",
      "maxItems": 512,
      "items": {
        "type": "object",
        "required": ["pins"],
        "additionalProperties": false,
        "properties": {"pins": {"type": "array", "minItems": 2, "maxItems": 64, "items": {"$ref": "#/$defs/pinName"}}}
      },
      "description": "Terminals joined inside the part (a breadboard's terminal strips and power rails): every pin of a group is one net, always, powered or not."
    },
    "mount": {
      "type": "object",
      "required": ["pins"],
      "additionalProperties": false,
      "properties": {
        "via": {"enum": ["direct", "interposer"], "default": "direct", "description": "direct: a right-angle 2x10 connector straight onto the Dot's J3 (Maker, Robotics, Camera). interposer: through the passive KDINT001 board (Mesh, hacking module); the case fixes the orientation."},
        "orientations": {"type": "array", "items": {"enum": ["upright", "turned"]}, "minItems": 1, "uniqueItems": true, "default": ["upright", "turned"], "description": "Which ways the module can be plugged in. Turned maps header position p to 15 - p (rails stay)."},
        "pins": {
          "type": "array", "maxItems": 14,
          "items": {"type": "object", "required": ["pin", "gpio"], "additionalProperties": false, "properties": {
            "pin": {"$ref": "#/$defs/pinName"},
            "gpio": {"enum": [8, 9, 10, 11, 12, 13, 14, 21, 19, 20, 17, 18, 15, 16], "description": "The ESP32-P4 GPIO this module pin meets when mounted upright (SDK positions 1..14 are GPIO 8 9 10 11 12 13 14 21 19 20 17 18 15 16)."},
            "source": {"enum": ["documented", "assumed"], "default": "documented", "description": "assumed: not established by a public source; the table is data and can be corrected."}}}
        },
        "connector": {"type": "object", "required": ["seat_mm", "pin_dir", "pin_length_mm"], "additionalProperties": false, "properties": {"cols": {"const": 10}, "rows": {"const": 2}, "pitch_mm": {"const": 2.54}, "seat_mm": {"type": "object", "required": ["x", "y", "z"], "additionalProperties": false, "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}}, "description": "Centre of the 2x10 pin block where the pins leave the part (the seating plane), part frame."}, "pin_dir": {"enum": ["+y", "-z"], "description": "Part-frame direction in which the pins point (into the Dot)."}, "pin_length_mm": {"type": "number"}, "odd_row": {"enum": ["low_z", "high_y"], "description": "Where pins 1,3,..19 of the connector sit: the row with the lower z (flat modules) or the larger y (standing modules). Assumed."}, "source": {"enum": ["documented", "assumed"]}}, "description": "The physical 2x10 mating connector. The 20 pins are in the pin list (ref says which position), terminal mm is the middle of the exposed pin."},
      "placement": {"type": "object", "required": ["anchor_dot_mm", "upright"], "additionalProperties": false, "properties": {"anchor_dot_mm": {"type": "object", "required": ["x", "y", "z"], "additionalProperties": false, "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number"}}, "description": "Where connector.seat_mm lands in the Dot's frame (X right, Y up, Z out of the screen, origin the centre of the Dot's bounding box): the middle of the top-wall connector."}, "upright": {"type": "object", "required": ["x", "y", "z"], "additionalProperties": false, "properties": {"x": {"enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]}, "y": {"enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]}, "z": {"enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]}}, "description": "Direction in the Dot's frame of the part's +x, +y, +z when plugged in upright."}, "turned": {"type": "object", "required": ["x", "y", "z"], "additionalProperties": false, "properties": {"x": {"enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]}, "y": {"enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]}, "z": {"enum": ["+X", "-X", "+Y", "-Y", "+Z", "-Z"]}}, "description": "The same plugged in turned (a half turn about the Dot's Y axis)."}, "source": {"enum": ["documented", "assumed"]}}, "description": "How a page places a mounted module in 3D. Components are mapped one by one (the part frame is left handed: x right, y down, z up), so the matrix has determinant -1."},
      "rails": {"type": "array", "maxItems": 16, "items": {"type": "object", "required": ["pin", "rail"], "additionalProperties": false, "properties": {"pin": {"$ref": "#/$defs/pinName"}, "rail": {"enum": ["V5", "V33", "GND"]}}}}
      },
      "description": "The part plugs onto the Dot's J3 header as a whole: bench.mountPart(instance, orientation) joins every listed pin to its header position and every rail pin to the rail, in one action."
    },
    "vih_pct": {"type": "integer", "minimum": 30, "maximum": 90, "description": "Input high threshold as a percentage of the logic supply (default 75). An ATmega328P reads 3.0 V as high on 5 V (60), so a 3.3 V Dot can drive an Uno R3 directly."},
    "logic_mv": {"type": "integer", "minimum": 500, "maximum": 60000, "description": "A board with an on-board regulator: the logic high level of its pins, whatever voltage its supply pin sees."},
    "tags": {"type": "array", "maxItems": 12, "items": {"type": "string", "pattern": "^[a-z0-9-]{1,24}$"}},
    "picture": {
      "type": "object",
      "required": ["file", "width", "height"],
      "additionalProperties": false,
      "properties": {
        "file": {"type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,80}\\.(png|webp|svg)$"},
        "width": {"type": "integer", "minimum": 32, "maximum": 2048},
        "height": {"type": "integer", "minimum": 32, "maximum": 2048}
      },
      "description": "width/height define the coordinate space used by every pos, region and visual in this manifest."
    },
    "refs": {"type": "array", "maxItems": 32, "items": {"type": "object", "required": ["name", "kind", "mm"], "additionalProperties": false, "properties": {"name": {"type": "string", "maxLength": 24}, "kind": {"enum": ["antenna_sma", "hole", "other"]}, "mm": {"$ref": "#/$defs/pin/properties/mm"}, "length_mm": {"type": "number", "minimum": 0, "description": "antenna_sma: length of the antenna standing on this base, base included, along +z."}, "note": {"type": "string", "maxLength": 200}}}, "description": "Non-electrical reference points of the body (antenna bases, mounting holes), same millimetre frame as the pins. A model may place geometry on them; estimates when body.estimate is true."},
    "model": {
      "type": "object",
      "required": ["file"],
      "additionalProperties": false,
      "properties": {
        "file": {"type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,80}\\.glb$"},
        "scale_mm": {
          "type": "number",
          "exclusiveMinimum": 0,
          "description": "Width of the picture in millimetres, to size the 3D model."
        }
      }
    },
    "pins": {"type": "array", "minItems": 1, "maxItems": 1024, "items": {"$ref": "#/$defs/pin"}},
    "wireless": {"type": "array", "maxItems": 4, "items": {"$ref": "#/$defs/wirelessPort"}},
    "fields": {"type": "array", "maxItems": 32, "items": {"$ref": "#/$defs/field"}},
    "controls": {"type": "array", "maxItems": 32, "items": {"$ref": "#/$defs/control"}},
    "outputs": {"type": "array", "maxItems": 32, "items": {"$ref": "#/$defs/output"}},
    "visuals": {"type": "array", "maxItems": 64, "items": {"$ref": "#/$defs/visual"}},
    "behaviour": {"oneOf": [{"$ref": "#/$defs/behaviourWasm"}, {"$ref": "#/$defs/behaviourDeclarative"}]},
    "requires": {
      "type": "object",
      "additionalProperties": false,
      "properties": {"dotbench": {"type": "string", "maxLength": 40, "description": "Semver range of the bench, e.g. >=1.0.0"}}
    },
    "build": {
      "type": "object",
      "description": "Written by `dotbench part build`. Do not edit.",
      "additionalProperties": false,
      "properties": {
        "toolchain": {"type": "string"},
        "dotcore": {"type": "string"},
        "api": {"type": "string"},
        "sources_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"}
      }
    }
  },
  "$defs": {
    "locale": {"type": "string", "pattern": "^[a-z]{2}(-[A-Z]{2})?$"},
    "localizedShort": {
      "type": "object",
      "required": ["en"],
      "propertyNames": {"$ref": "#/$defs/locale"},
      "additionalProperties": {"type": "string", "minLength": 1, "maxLength": 48}
    },
    "localizedLong": {
      "type": "object",
      "required": ["en"],
      "propertyNames": {"$ref": "#/$defs/locale"},
      "additionalProperties": {"type": "string", "minLength": 1, "maxLength": 2000},
      "description": "en is required; pt-BR and es are expected by the Make your own checklist."
    },
    "pinName": {"type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_]{0,23}$"},
    "fieldName": {"type": "string", "pattern": "^[a-z][a-z0-9_]{0,31}$"},
    "color": {"type": "string", "pattern": "^#[0-9a-fA-F]{6}$"},
    "point": {
      "type": "object",
      "required": ["x", "y"],
      "additionalProperties": false,
      "properties": {"x": {"type": "number", "minimum": 0, "maximum": 2048}, "y": {"type": "number", "minimum": 0, "maximum": 2048}}
    },
    "region": {
      "type": "object",
      "required": ["x", "y", "w", "h"],
      "additionalProperties": false,
      "properties": {
        "x": {"type": "number", "minimum": 0},
        "y": {"type": "number", "minimum": 0},
        "w": {"type": "number", "exclusiveMinimum": 0},
        "h": {"type": "number", "exclusiveMinimum": 0}
      }
    },
    "pin": {
      "type": "object",
      "required": ["name", "kind", "pos"],
      "additionalProperties": false,
      "properties": {
        "name": {"$ref": "#/$defs/pinName"},
        "kind": {
          "enum": ["io", "analog", "power_in", "power_out", "ground", "nc"],
          "description": "io: digital in/out. analog: also an analog source or sense. power_in: needs a supply. power_out: supplies a rail. ground: 0 V reference. nc: decorative."
        },
        "label": {"$ref": "#/$defs/localizedShort"},
        "gpio": {
          "type": "integer",
          "minimum": 0,
          "maximum": 255,
          "description": "The Arduino pin number firmware uses for this terminal (wasm behaviour only)."
        },
        "pos": {"$ref": "#/$defs/point"},
        "default": {
          "enum": ["z", "in", "in_pullup", "in_pulldown", "out_low", "out_high"],
          "default": "z",
          "description": "State after power-up, before firmware runs."
        },
        "pullup_ohms": {"type": "number", "minimum": 100, "maximum": 10000000},
        "pulldown_ohms": {"type": "number", "minimum": 100, "maximum": 10000000},
        "pull_rail": {
          "$ref": "#/$defs/pinName",
          "description": "Name of the power_in/power_out pin of this part a pull-up goes to. Defaults to the first power_in pin."
        },
        "series_ohms": {"type": "number", "minimum": 0, "maximum": 100000, "default": 0},
        "abs_max_mv": {
          "type": "integer",
          "minimum": 0,
          "maximum": 60000,
          "default": 3600,
          "description": "Voltage above which the bench shows an over-voltage warning."
        },
        "min_mv": {"type": "integer", "description": "power_in: lowest supply voltage at which the part runs."},
        "max_mv": {"type": "integer", "description": "power_in: highest supply voltage the part tolerates."},
        "typ_ma": {
          "type": "number",
          "minimum": 0,
          "description": "power_in: typical current, shown against the 5 V budget (0.5 A on the Kode Dot)."
        },
        "out_mv": {"type": "integer", "description": "power_out: the voltage it supplies while the part is powered."},
        "out_ohms": {"type": "number", "minimum": 0.001, "description": "power_out: output resistance (default 5)."},
        "supply_group": {"type": "string", "maxLength": 16, "description": "power_in: pins with the same group are alternatives (VIN or 5V); the part runs when one of them is in range. Pins without a group are all required."},
        "internal": {
          "type": "object",
          "required": ["mv"],
          "additionalProperties": false,
          "properties": {
            "mv": {"type": "integer", "minimum": 0, "maximum": 60000},
            "ohms": {"type": "number", "minimum": 0.001},
            "field": {"$ref": "#/$defs/fieldName", "description": "A boolean field (for example usb); the pin is driven only while it is true."}
          },
          "description": "The pin is driven by the part's own supply (a board on USB): a source of mv, and the part's ground pins become a 0 V reference."
        },
        "mm": {
          "type": "object",
          "required": ["x", "y"],
          "additionalProperties": false,
          "properties": {"x": {"type": "number"}, "y": {"type": "number"}, "z": {"type": "number", "description": "Height of the contact point above the table. Default: the face's own height (top: body.h_mm, bottom: 0)."}},
          "description": "Terminal position in millimetres on the footprint (origin top-left, x right, y down, see body)."
        },
        "caps": {
          "type": "array", "maxItems": 12, "uniqueItems": true,
          "items": {"enum": ["digital", "pwm", "analog", "dac", "interrupt", "i2c_sda", "i2c_scl", "spi_sck", "spi_miso", "spi_mosi", "spi_ss", "uart_rx", "uart_tx", "touch", "boot_strap", "input_only"]},
          "description": "What the pin can do on the real board (a board part: pin capabilities for the page and the sketch editor). Informational: the part still decides what its sketch does."
        },
        "ref": {"type": "string", "maxLength": 24, "description": "Non-electrical: the board designator and pin number of this terminal on the real part (J401.17)."},
        "face": {"enum": ["top", "bottom", "left", "right", "front", "back"], "default": "top", "description": "Which face the terminal is on: top (header pins, screw terminals), bottom (leads that plug into a breadboard), left/right (x edges), front (y = d_mm) and back (y = 0)."}
      },
      "allOf": [
        {
          "if": {"properties": {"kind": {"const": "power_in"}}, "required": ["kind"]},
          "then": {"required": ["min_mv", "max_mv"]}
        },
        {
          "if": {"properties": {"kind": {"const": "power_out"}}, "required": ["kind"]},
          "then": {"required": ["out_mv"]}
        }
      ]
    },
    "wirelessPort": {
      "type": "object",
      "required": ["name", "medium", "role"],
      "additionalProperties": false,
      "properties": {
        "name": {"$ref": "#/$defs/pinName"},
        "medium": {"enum": ["nfc_a", "rfid_125k", "ble", "wifi", "ir"]},
        "role": {
          "type": "string",
          "pattern": "^[a-z_]{2,24}$",
          "description": "Valid roles per medium: nfc_a target|initiator, rfid_125k tag|reader, ble peripheral|central, wifi ap|station, ir tx|rx."
        },
        "range_mm": {"type": "number", "minimum": 0, "maximum": 100000},
        "pos": {"$ref": "#/$defs/point"},
        "config": {"type": "object", "description": "Medium-specific; validated by the stage that owns the medium."}
      }
    },
    "field": {
      "oneOf": [
        {
          "type": "object",
          "required": ["name", "type", "label", "default"],
          "additionalProperties": false,
          "properties": {
            "name": {"$ref": "#/$defs/fieldName"},
            "type": {"enum": ["number", "integer"]},
            "label": {"$ref": "#/$defs/localizedShort"},
            "min": {"type": "number"},
            "max": {"type": "number"},
            "step": {"type": "number", "exclusiveMinimum": 0},
            "unit": {"type": "string", "maxLength": 8},
            "default": {"type": "number"},
            "ui": {"enum": ["input", "slider", "knob"], "default": "input"},
            "advanced": {"type": "boolean"}
          }
        },
        {
          "type": "object",
          "required": ["name", "type", "label", "default"],
          "additionalProperties": false,
          "properties": {
            "name": {"$ref": "#/$defs/fieldName"},
            "type": {"const": "boolean"},
            "label": {"$ref": "#/$defs/localizedShort"},
            "default": {"type": "boolean"},
            "advanced": {"type": "boolean"}
          }
        },
        {
          "type": "object",
          "required": ["name", "type", "label", "default", "values"],
          "additionalProperties": false,
          "properties": {
            "name": {"$ref": "#/$defs/fieldName"},
            "type": {"const": "enum"},
            "label": {"$ref": "#/$defs/localizedShort"},
            "default": {"type": ["number", "string"]},
            "values": {
              "type": "array",
              "minItems": 2,
              "maxItems": 32,
              "items": {
                "type": "object",
                "required": ["value", "label"],
                "additionalProperties": false,
                "properties": {"value": {"type": ["number", "string"]}, "label": {"$ref": "#/$defs/localizedShort"}}
              }
            },
            "advanced": {"type": "boolean"}
          }
        },
        {
          "type": "object",
          "required": ["name", "type", "label", "default"],
          "additionalProperties": false,
          "properties": {
            "name": {"$ref": "#/$defs/fieldName"},
            "type": {"const": "string"},
            "label": {"$ref": "#/$defs/localizedShort"},
            "default": {"type": "string", "maxLength": 256},
            "maxLength": {"type": "integer", "minimum": 1, "maximum": 256},
            "pattern": {"type": "string", "maxLength": 120},
            "advanced": {"type": "boolean"}
          }
        },
        {
          "type": "object",
          "required": ["name", "type", "label", "default"],
          "additionalProperties": false,
          "properties": {
            "name": {"$ref": "#/$defs/fieldName"},
            "type": {"const": "bytes"},
            "label": {"$ref": "#/$defs/localizedShort"},
            "default": {
              "type": "string",
              "pattern": "^([0-9a-fA-F]{2})*$",
              "maxLength": 512,
              "description": "Hex string, e.g. a tag UID."
            },
            "max_bytes": {"type": "integer", "minimum": 1, "maximum": 256},
            "advanced": {"type": "boolean"}
          }
        },
        {
          "type": "object",
          "required": ["name", "type", "label", "default"],
          "additionalProperties": false,
          "properties": {
            "name": {"$ref": "#/$defs/fieldName"},
            "type": {"const": "color"},
            "label": {"$ref": "#/$defs/localizedShort"},
            "default": {"$ref": "#/$defs/color"},
            "advanced": {"type": "boolean"}
          }
        }
      ]
    },
    "control": {
      "type": "object",
      "required": ["field", "region", "mode"],
      "additionalProperties": false,
      "properties": {
        "field": {"$ref": "#/$defs/fieldName"},
        "region": {"$ref": "#/$defs/region"},
        "mode": {"enum": ["toggle", "momentary", "drag_x", "drag_y", "rotate"]},
        "label": {"$ref": "#/$defs/localizedShort"}
      }
    },
    "output": {
      "type": "object",
      "required": ["name", "type"],
      "additionalProperties": false,
      "properties": {
        "name": {"$ref": "#/$defs/fieldName"},
        "type": {"enum": ["number", "boolean"]},
        "unit": {"type": "string", "maxLength": 8},
        "min": {"type": "number"},
        "max": {"type": "number"},
        "label": {"$ref": "#/$defs/localizedShort"}
      }
    },
    "visual": {
      "type": "object",
      "required": ["id", "effect", "source"],
      "additionalProperties": false,
      "properties": {
        "id": {"type": "string", "pattern": "^[a-z][a-z0-9_]{0,23}$"},
        "effect": {"enum": ["glow", "fill", "rotate", "opacity", "text", "bar"]},
        "x": {"type": "number"},
        "y": {"type": "number"},
        "w": {"type": "number"},
        "h": {"type": "number"},
        "r": {"type": "number"},
        "color": {"$ref": "#/$defs/color"},
        "source": {
          "oneOf": [
            {
              "type": "object",
              "required": ["pin"],
              "additionalProperties": false,
              "properties": {"pin": {"$ref": "#/$defs/pinName"}}
            },
            {
              "type": "object",
              "required": ["gpio"],
              "additionalProperties": false,
              "properties": {"gpio": {"type": "integer", "minimum": 0, "maximum": 255}},
              "description": "A firmware pin with no terminal (an on-board LED)."
            },
            {
              "type": "object",
              "required": ["output"],
              "additionalProperties": false,
              "properties": {"output": {"$ref": "#/$defs/fieldName"}}
            },
            {
              "type": "object",
              "required": ["field"],
              "additionalProperties": false,
              "properties": {"field": {"$ref": "#/$defs/fieldName"}}
            }
          ]
        },
        "scale": {
          "type": "object",
          "required": ["in", "out"],
          "additionalProperties": false,
          "properties": {
            "in": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2},
            "out": {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}
          }
        }
      }
    },
    "behaviourWasm": {
      "type": "object",
      "required": ["type", "entry", "abi"],
      "additionalProperties": false,
      "properties": {
        "type": {"const": "wasm"},
        "entry": {"type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,80}\\.wasm$"},
        "abi": {"const": 1},
        "core": {"enum": ["esp32", "esp32-s3", "uno-r3", "uno-r4-minima", "uno-r4-wifi"], "default": "esp32", "description": "Which dotcore variant the sketch is compiled against: pin names and numbers, analogRead and analogWrite resolution, PWM pins, default Wire and SPI pins."},
        "memory_kb": {"type": "integer", "minimum": 256, "maximum": 8192, "default": 1024},
        "stack_kb": {"type": "integer", "minimum": 16, "maximum": 512, "default": 64},
        "wasm_sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
        "sources": {
          "type": "array",
          "maxItems": 64,
          "items": {"type": "string", "maxLength": 120},
          "description": "Informational: source files shipped under src/."
        }
      }
    },
    "expr": {
      "oneOf": [
        {"type": ["number", "boolean", "string"]},
        {
          "type": "object",
          "required": ["field"],
          "additionalProperties": false,
          "properties": {"field": {"$ref": "#/$defs/fieldName"}, "scale": {"type": "number"}, "offset": {"type": "number"}}
        },
        {
          "type": "object",
          "required": ["field", "op", "value"],
          "additionalProperties": false,
          "properties": {
            "field": {"$ref": "#/$defs/fieldName"},
            "op": {"enum": ["eq", "ne", "gt", "ge", "lt", "le"]},
            "value": {"type": ["number", "boolean", "string"]}
          }
        }
      ]
    },
    "behaviourDeclarative": {
      "type": "object",
      "required": ["type", "engine", "elements"],
      "additionalProperties": false,
      "properties": {
        "type": {"const": "declarative"},
        "engine": {"const": 1},
        "elements": {"type": "array", "minItems": 1, "maxItems": 64, "items": {"$ref": "#/$defs/element"}}
      }
    },
    "element": {
      "oneOf": [
        {
          "type": "object",
          "required": ["type", "a", "b", "closed"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "switch"},
            "a": {"$ref": "#/$defs/pinName"},
            "b": {"$ref": "#/$defs/pinName"},
            "closed": {"$ref": "#/$defs/expr"},
            "bounce_ms": {"type": "number", "minimum": 0, "maximum": 20}
          }
        },
        {
          "type": "object",
          "required": ["type", "a", "b"],
          "additionalProperties": false,
          "properties": {"type": {"const": "bridge"}, "a": {"$ref": "#/$defs/pinName"}, "b": {"$ref": "#/$defs/pinName"}}
        },
        {
          "type": "object",
          "required": ["type", "top", "bottom", "wiper", "ohms", "position"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "divider"},
            "top": {"$ref": "#/$defs/pinName"},
            "bottom": {"$ref": "#/$defs/pinName"},
            "wiper": {"$ref": "#/$defs/pinName"},
            "ohms": {"type": "number", "minimum": 100},
            "position": {"$ref": "#/$defs/expr"}
          }
        },
        {
          "type": "object",
          "required": ["type", "pin", "mv"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "source"},
            "pin": {"$ref": "#/$defs/pinName"},
            "mv": {"$ref": "#/$defs/expr"},
            "ohms": {"type": "number", "minimum": 1, "default": 100}
          }
        },
        {
          "type": "object",
          "required": ["type", "pin", "level"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "drive"},
            "pin": {"$ref": "#/$defs/pinName"},
            "mode": {"enum": ["push_pull", "open_drain"], "default": "push_pull"},
            "level": {"$ref": "#/$defs/expr"}
          }
        },
        {
          "type": "object",
          "required": ["type", "sda", "scl", "address", "registers"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "i2c_slave"},
            "sda": {"$ref": "#/$defs/pinName"},
            "scl": {"$ref": "#/$defs/pinName"},
            "address": {
              "oneOf": [
                {"type": "integer", "minimum": 8, "maximum": 119},
                {
                  "type": "object",
                  "required": ["field"],
                  "additionalProperties": false,
                  "properties": {"field": {"$ref": "#/$defs/fieldName"}}
                }
              ]
            },
            "pointer_bytes": {
              "enum": [0, 1],
              "default": 1,
              "description": "1: first written byte selects the register. 0: no pointer, a read returns register 0."
            },
            "auto_increment": {"type": "boolean", "default": true},
            "registers": {
              "type": "array",
              "minItems": 1,
              "maxItems": 64,
              "items": {
                "type": "object",
                "required": ["reg", "size", "access"],
                "additionalProperties": false,
                "properties": {
                  "reg": {"type": "integer", "minimum": 0, "maximum": 255},
                  "size": {"type": "integer", "minimum": 1, "maximum": 4},
                  "access": {"enum": ["ro", "rw"]},
                  "default": {"type": "integer", "minimum": 0},
                  "value": {
                    "type": "object",
                    "required": ["field"],
                    "additionalProperties": false,
                    "properties": {
                      "field": {"$ref": "#/$defs/fieldName"},
                      "scale": {"type": "number", "default": 1},
                      "offset": {"type": "number", "default": 0},
                      "signed": {"type": "boolean", "default": false},
                      "endian": {"enum": ["big", "little"], "default": "big"},
                      "left_align_bits": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 16,
                        "default": 0,
                        "description": "Shift left, for registers whose low bits are unused (LM75: 7)."
                      }
                    }
                  }
                }
              }
            }
          }
        },
        {
          "type": "object",
          "required": ["type", "in1", "in2", "output"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "h_bridge"},
            "in1": {"$ref": "#/$defs/pinName"},
            "in2": {"$ref": "#/$defs/pinName"},
            "output": {"$ref": "#/$defs/fieldName", "description": "Name of an outputs[] entry that receives speed in -1..1."},
            "enable": {"$ref": "#/$defs/pinName", "description": "Optional nSLEEP-style pin that must read high."}
          }
        },
        {
          "type": "object",
          "required": ["type", "pin", "output"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "servo"},
            "pin": {"$ref": "#/$defs/pinName"},
            "output": {"$ref": "#/$defs/fieldName"},
            "min_us": {"type": "number", "default": 1000},
            "max_us": {"type": "number", "default": 2000},
            "range_deg": {"type": "number", "default": 180}
          }
        },
        {
          "type": "object",
          "required": ["type", "port"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "wireless"},
            "port": {"$ref": "#/$defs/pinName"},
            "config": {"type": "object", "description": "Medium-specific; may use { \"field\": name } values."}
          }
        },
        {
          "type": "object",
          "required": ["type", "anode", "cathode", "output"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "led"},
            "anode": {"$ref": "#/$defs/pinName"},
            "cathode": {"$ref": "#/$defs/pinName"},
            "output": {
              "$ref": "#/$defs/fieldName",
              "description": "Name of an outputs[] entry that receives the brightness, 0..1."
            },
            "vf_mv": {"type": "number", "minimum": 0, "maximum": 5000, "default": 1900, "description": "Forward voltage."},
            "series_ohms": {
              "oneOf": [
                {"type": "number", "minimum": 0},
                {
                  "type": "object",
                  "required": ["field"],
                  "additionalProperties": false,
                  "properties": {"field": {"$ref": "#/$defs/fieldName"}}
                }
              ],
              "description": "Resistor in series with the LED (a number or a number field)."
            },
            "full_ma": {
              "type": "number",
              "exclusiveMinimum": 0,
              "default": 10,
              "description": "Current at which brightness is 1."
            }
          }
        },
        {
          "type": "object",
          "required": ["type", "pin", "output"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "buzzer"},
            "pin": {"$ref": "#/$defs/pinName"},
            "ref": {
              "$ref": "#/$defs/pinName",
              "description": "Optional return pin; the buzzer sounds only when it is on the ground net."
            },
            "output": {
              "$ref": "#/$defs/fieldName",
              "description": "Name of an outputs[] entry that receives the sounding frequency in Hz (0 = silent)."
            }
          }
        },
        {
          "type": "object",
          "required": ["type", "a", "b", "ohms"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "resistor"},
            "a": {"$ref": "#/$defs/pinName"}, "b": {"$ref": "#/$defs/pinName"},
            "ohms": {"oneOf": [{"type": "number", "minimum": 0}, {"type": "object", "required": ["field"], "additionalProperties": false, "properties": {"field": {"$ref": "#/$defs/fieldName"}, "scale": {"type": "number"}}}]},
            "rated_mw": {"type": "number", "exclusiveMinimum": 0, "description": "Power rating; above it the bench shows an overpower hazard."},
            "current_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A resistor between two terminals, solved with the nets (it loads them)."
        },
        {
          "type": "object",
          "required": ["type", "a", "b", "farads"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "capacitor"},
            "a": {"$ref": "#/$defs/pinName"}, "b": {"$ref": "#/$defs/pinName"},
            "farads": {"$ref": "#/$defs/expr", "description": "Capacitance in farads (use {field, scale} to edit it in microfarads)."},
            "esr_ohms": {"type": "number", "minimum": 0},
            "polarity": {
              "type": "object", "required": ["plus"], "additionalProperties": false,
              "properties": {"plus": {"$ref": "#/$defs/pinName"}, "reverse_mv": {"type": "number", "default": 1000}},
              "description": "An electrolytic: the plus terminal. Reverse voltage above reverse_mv for 40 ms bursts it (open circuit until repaired)."
            },
            "max_mv": {"type": "number", "description": "Voltage rating; above it the capacitor fails."},
            "voltage_output": {"$ref": "#/$defs/fieldName"}, "failed_output": {"$ref": "#/$defs/fieldName"}, "reversed_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A capacitor with its own voltage in virtual time (backward Euler)."
        },
        {
          "type": "object",
          "required": ["type", "anode", "cathode"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "diode"},
            "anode": {"$ref": "#/$defs/pinName"}, "cathode": {"$ref": "#/$defs/pinName"},
            "vf_mv": {"type": "number", "minimum": 0, "maximum": 5000, "default": 700},
            "rs_ohms": {"type": "number", "minimum": 0.001, "default": 10, "description": "Dynamic resistance above the knee."},
            "max_ma": {"type": "number", "exclusiveMinimum": 0, "description": "Above 105 % of it: overcurrent hazard; for burn_ms (default 60) of virtual time: the part burns out (open circuit until repaired)."},
            "burn_ms": {"type": "number", "minimum": 0},
            "full_ma": {"type": "number", "exclusiveMinimum": 0, "default": 10, "description": "Current at which brightness is 1."},
            "output": {"$ref": "#/$defs/fieldName", "description": "Brightness 0..1."},
            "current_output": {"$ref": "#/$defs/fieldName"}, "overcurrent_output": {"$ref": "#/$defs/fieldName"}, "burnt_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A diode or LED that conducts above vf_mv; it loads its nets (unlike the older `led` element)."
        },
        {
          "type": "object",
          "required": ["type", "pos", "neg", "mv"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "cell"},
            "pos": {"$ref": "#/$defs/pinName"}, "neg": {"$ref": "#/$defs/pinName"},
            "mv": {"$ref": "#/$defs/expr"},
            "ohms": {"type": "number", "minimum": 0.001, "default": 1.5},
            "max_ma": {"type": "number", "exclusiveMinimum": 0, "description": "Above it an overcurrent hazard is shown."},
            "current_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A floating voltage source (battery, bench supply): + at `pos`, `mv` above `neg`; its minus is 0 V when nothing else defines the reference."
        },
        {
          "type": "object",
          "required": ["type", "a", "b"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "motor"},
            "a": {"$ref": "#/$defs/pinName"}, "b": {"$ref": "#/$defs/pinName"},
            "ohms": {"type": "number", "minimum": 0.1, "default": 8, "description": "Winding resistance: the motor loads its nets (no back-EMF, no inductance)."},
            "rated_mv": {"type": "number", "default": 6000}, "start_mv": {"type": "number", "default": 500, "description": "Below this voltage it does not turn."},
            "rpm": {"type": "number", "default": 200, "description": "Speed at rated_mv, no load."},
            "max_ma": {"type": "number", "description": "Stall current: above it an overcurrent hazard is shown."},
            "speed_output": {"$ref": "#/$defs/fieldName", "description": "-1..1 (sign = direction), 1 at rated_mv; a PWM-driven motor follows the average voltage."},
            "rpm_output": {"$ref": "#/$defs/fieldName"}, "current_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A brushed DC motor: a winding resistance and a speed that follows the voltage across it."
        },
        {
          "type": "object",
          "required": ["type", "in", "out", "vs"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "half_bridge"},
            "in": {"$ref": "#/$defs/pinName"}, "out": {"$ref": "#/$defs/pinName"}, "vs": {"$ref": "#/$defs/pinName", "description": "The motor supply pin; the output swings between it (minus drop_mv) and 0 V."},
            "en": {"$ref": "#/$defs/pinName", "description": "Enable: low (and not PWM) leaves the output high impedance; a PWM enable chops the output."},
            "drop_mv": {"type": "number", "default": 1400}, "ohms": {"type": "number", "default": 2},
            "output": {"$ref": "#/$defs/fieldName", "description": "Output level as a fraction of vs, 0..1."}
          },
          "description": "One leg of an H-bridge driving its `out` pin (a real source on the net, unlike the older h_bridge element)."
        },
        {
          "type": "object",
          "required": ["type", "in1", "in2", "in3", "in4"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "stepper_unipolar"},
            "in1": {"$ref": "#/$defs/pinName"}, "in2": {"$ref": "#/$defs/pinName"}, "in3": {"$ref": "#/$defs/pinName"}, "in4": {"$ref": "#/$defs/pinName"},
            "steps_per_rev": {"type": "integer", "default": 4096, "description": "Half steps per output-shaft revolution (28BYJ-48: 4096)."},
            "max_sps": {"type": "number", "default": 1000, "description": "Half steps per second above which the rotor skips (stalled)."},
            "position_output": {"$ref": "#/$defs/fieldName"}, "angle_output": {"$ref": "#/$defs/fieldName"}, "stalled_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A unipolar stepper behind a ULN2003: the energised-coil pattern on in1..in4 moves the shaft one half step per phase."
        },
        {
          "type": "object",
          "required": ["type", "step", "dir"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "stepper_step_dir"},
            "step": {"$ref": "#/$defs/pinName"}, "dir": {"$ref": "#/$defs/pinName"}, "en": {"$ref": "#/$defs/pinName"},
            "ms1": {"$ref": "#/$defs/pinName"}, "ms2": {"$ref": "#/$defs/pinName"}, "ms3": {"$ref": "#/$defs/pinName"},
            "rst": {"$ref": "#/$defs/pinName"}, "slp": {"$ref": "#/$defs/pinName"},
            "steps_per_rev": {"type": "integer", "default": 200, "description": "Full steps per revolution (NEMA 17: 200)."},
            "max_sps": {"type": "number", "default": 2000, "description": "Full steps per second above which the rotor skips."},
            "position_output": {"$ref": "#/$defs/fieldName", "description": "Position in 1/16 full steps (the finest A4988 microstep)."},
            "angle_output": {"$ref": "#/$defs/fieldName"}, "stalled_output": {"$ref": "#/$defs/fieldName"}, "microstep_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A bipolar stepper behind an A4988-style step/dir driver: each rising STEP edge moves 1, 1/2, 1/4, 1/8 or 1/16 full step by the MS pins, in the DIR direction, while EN is low and RST and SLP are high."
        },
        {
          "type": "object",
          "required": ["type", "in", "com", "no", "nc"],
          "additionalProperties": false,
          "properties": {
            "type": {"const": "relay"},
            "in": {"$ref": "#/$defs/pinName"},
            "active": {"oneOf": [{"enum": ["low", "high"]}, {"type": "object", "required": ["field", "op", "value"], "additionalProperties": false, "properties": {"field": {"$ref": "#/$defs/fieldName"}, "op": {"enum": ["eq", "ne", "gt", "ge", "lt", "le"]}, "value": {"type": ["number", "boolean", "string"]}}}], "default": "low"},
            "com": {"$ref": "#/$defs/pinName"}, "no": {"$ref": "#/$defs/pinName"}, "nc": {"$ref": "#/$defs/pinName"},
            "coil_ms": {"type": "number", "default": 8, "description": "Virtual time the contact takes to move."},
            "energized_output": {"$ref": "#/$defs/fieldName"}, "closed_output": {"$ref": "#/$defs/fieldName"}
          },
          "description": "A relay: COM joins NC at rest, NO when the coil is energised (module powered and IN at its active level). With the module unpowered COM-NC still conducts."
        }
      ]
    }
  }
}
```

## 6. Finished examples to copy from

`manifest.json` (a wasm part: ESP32 acting as an LM75-style I2C temperature sensor) with `src/main.ino`, and `examples/lm75-declarative.manifest.json` (the same sensor with no code), `examples/button-module.manifest.json` (a momentary switch). Open them and follow their style.

## 7. What to output when you are done

Give the user a short report in their language: (1) what the part does; (2) the files you created or changed; (3) which commands you ran and that `check` and `test` passed (paste the final lines); (4) **how to wire it**: for each pin, which Kode Dot terminal to connect (EXPn, V33 or V5, GND), including that the app must switch the rail on first; (5) which fields the user can change and what happens; (6) the assumptions you made; (7) any limit of the simulation that matters for this part. Keep it brief.

Now read the folder, then do what the user asks on the last line.

Write what you want here:
