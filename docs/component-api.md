# dotbench custom components: design (stage 6)

Status: design plus a working spike. Date: 2026-11-16. Owner of this area: component API.
Spike: `spikes/arduino/` (read its README for exact commands and numbers). Starter folder draft: `templates/component-starter/`.
Parent spec: `docs/superpowers/specs/2026-11-16-dotbench-design.md` ("Acréscimos pedidos depois" and "Etapa 6").
Companion: `docs/bench-spec.md` (Expansion section) describes what the device side of J3 must do; this document describes what is wired to it.

This document is written so that three engineers can work independently:

| Engineer | Builds | Reads first |
|---|---|---|
| A, wiring router | net model, solver, bus routing, conflict display, `.dotlayout` wiring | sections 1, 5, 9 |
| B, component runtime | `.dotpart` loader, Worker host, wasm ABI, declarative runner, clock, `dotbench part` CLI, dotcore | sections 2, 3, 4, 5.7 to 5.9, 7, 8 |
| C, "Make your own" tab | manual, starter download, import dialog, part editor/preview | sections 3, 8.3, 10 and the starter folder |

Words: a **part** is a component instance on the bench; a **terminal** is one wirable point (a pin of a part, or one of the device's header terminals); a **net** is a set of terminals joined by wires; the **device** is the Kode Dot (the wasm app plus fake drivers); the **router** is the single authority that owns nets, buses and wireless links.

---

## 1. What the Kode Dot can do on the expansion header (research, Part A.1)

Everything below comes from files in `/home/claude/src/kode-sdk` (read only, commit `c9568a3` per the parent spec). It defines what a wired part can observe and do.

### 1.1 The terminals

Apps see **14 positions, numbered 1..14** as printed on connector J3 (`components/kode/include/kode.h:1676-1691`, `KODE_PIN_FIRST/LAST`). The GPIO behind each position is in `components/kbsp/exp/src/kbsp_exp.c` (table `KBSP_EXP`, and `components/kbsp/board/include/kbsp_pins.h:94-108`). Each pin has a 68 ohm series resistor (`kbsp_pins.h:94`).

| Position (terminal) | GPIO | ADC1 channel | LP pin (works asleep) |
|---|---|---|---|
| EXP1 | 8 | none | yes |
| EXP2 | 9 | none | yes |
| EXP3 | 10 | none | yes |
| EXP4 | 11 | none | yes |
| EXP5 | 12 | none | yes |
| EXP6 | 13 | none | yes |
| EXP7 | 14 | none | yes |
| EXP8 | 21 | 5 | no |
| EXP9 | 19 | 3 | no |
| EXP10 | 20 | 4 | no |
| EXP11 | 17 | 1 | no |
| EXP12 | 18 | 2 | no |
| EXP13 | 15 | none | yes |
| EXP14 | 16 | 0 | no |

Analog reads work only on EXP8 to EXP12 and EXP14 (`kode.h:1710`). Power: `+3.3V_EXT` (J3 pins 2 and 19, `kode.h:1725`) and `+5V` (pins 1 and 20, `kode_sys.h`, comment of `kode_sys_exp_power`). The physical order of the 14 positions on the 20-pin connector is **not stated in the SDK**. `docs/bench-spec.md` (Expansion, section 4) quotes the device docs: J3 pins 1 and 20 are 5 V, 2 and 19 are 3.3 V, pins 3 to 9 and 12 to 18 carry GPIO8 to GPIO21. This design therefore models the header as terminals `EXP1..EXP14`, `V33`, `V5`, `GND` and keeps the physical layout (which connector pin is which) in one data table owned by the device picture (default: P3..P9 = EXP1..EXP7, P12..P18 = EXP8..EXP14, P10 and P11 = GND by elimination). **Which J3 pins are ground is an owner question (section 12, Q1).**

### 1.2 What an app can do, call by call

| Role | API (kode.h) | Exact limits | Notes |
|---|---|---|---|
| GPIO output | `kode_pin_write(pin, level)` (1699) | push-pull only, no open-drain | blocks, one task at a time (`kode.h:1676`); the kode_sys layer below it is a command posted to the pin's owner (per `docs/bench-spec.md`), so this is not a bit-bang interface (latency not measured) |
| GPIO input | `kode_pin_read(pin)` (1706) | input with **no pull** | the app cannot enable a pull through kode.h; `kode_sys.h:2143` has pull up/down for kodeOS-image code only |
| Edge events | event `pin_<n>_changed` (`kode.h:206-215`) | any edge, read 30 ms after the edge (`KODE_PIN_SETTLE_MS`), bounces collapse to one event at the settled level | a listened pin is input-only |
| PWM out | `kode_pin_write_pwm(pin, hz, duty_pct)` (1722) | 1..40000 Hz, duty 0..100 integer percent (`KHAL_EXP_PWM_DUTY_MAX` 1000 tenths exist below the API) | output only: **no PWM input, no capture, no DAC** |
| ADC | `kode_pin_read_analog(pin)` (1713) | millivolts, EXP8..12 and 14; 12-bit at 12 dB (`khal_exp_port.h`); `EXPIO_ADC_FULL_MV` 3100 in the example | calibrated mv (`calibrated` flag below the API) |
| Rails | `kode_pin_power_3v3(on)` (1756), `kode_pin_power_5v(on)` (1769) | 3V3 through the C5 radio chip, waits up to 300 s; 5 V up to 0.5 A, refused on USB or low cell | **state at boot not promised**: a part is unpowered until the app switches the rail |
| I2C | `kode_i2c_begin/probe/write/read/write_read/end` (1809-1857) | **master only**, 7-bit, 10 kHz to 400 kHz, 100 ms silent timeout per segment (`KODE_I2C_TIMEOUT_MS`), probe tries twice, internal pull-ups **on** | one bus open at a time; any two positions for SDA/SCL |
| SPI | `kode_spi_begin/transfer/end` (1883-1905) | **master only**, one device, CS driven by the controller (low for the whole transfer), 100 kHz to 10 MHz, mode 0..3, **64 bytes per transfer** (FIFO, no DMA) | MISO with nothing attached "holds whatever the data-in pin floated at" |
| UART | `kode_uart_begin/write/read/end` (1929-1959) | **8N1 only**, 1200 to 921600 baud, RX ring 1024 bytes (overflow drops), write blocks for the byte time less 128, read waits up to `ms` | one UART at a time, TX and RX on any positions, **no flow control** |
| Exclusivity | `kode.h:1773-1787` | a pin lent to a bus fails `kode_pin_*` with "pin N is lent to i2c"; a listened pin fails writes | one I2C, one SPI and one UART can be open together (separate flags in `components/kode/src/kode_bus.c`) |

So the device is **master only** on I2C and SPI, a plain 8N1 peer on UART, an output/input/analog/PWM pin driver, and the supplier (or not) of both rails. It can never be an I2C or SPI slave, never measure a pulse, never speak 1-Wire, I2S, CAN or a framed single-wire protocol except by slow `kode_pin_write` calls. Components that need those cannot work against it, and the bench says so (section 5.10).

### 1.3 Where a fake driver hooks in

The SDK is layered; the fake hardware goes under the real logic (`components/khal/exp/src/khal_exp.c` is plain bookkeeping and compiles unchanged):

| Layer (real file) | What it calls below | Web replacement (owned by the runtime engineer, `runtime/drivers/exp/`) |
|---|---|---|
| `kode_pin.c`, `kode_bus.c` (kode) | `kode_sys_exp_*`, then `kdrv_exp_*` | unchanged |
| `khal_exp.c` (`khal_exp.h`) | `khal_gpio_input/output/write/level/release/irq_attach/irq_enable` (`khal/gpio/include/khal_gpio.h:42-139`), `khal_pwm_open/set/close` (`khal/pwm/include/khal_pwm.h:62-99`), `khal_exp_port_adc_open/read/close` (`khal/exp/src/khal_exp_port.h`) | fake `khal_gpio` (by GPIO number), fake `khal_pwm`, fake ADC port. They talk to the **device endpoint** of the router (section 5.2) |
| `kdrv_exp_bus.c` (`kdrv/exp_bus/include/kdrv_exp_bus.h`): `kdrv_exp_i2c_open/xfer/probe/close`, `kdrv_exp_spi_open/xfer/close`, `kdrv_exp_uart_open/write/read/close` | IDF drivers | **replace the whole file** with a web driver. Arguments arrive as GPIO numbers; the driver maps GPIO to terminal with the table in 1.1 |
| rails: `kode_sys_exp_power(bool)` (`kode_sys.h:579`), `kode_sys_power_boost(bool)` (5 V) | the C5 radio / BQ25896 | fake power owner calls `router.setRail("V33" or "V5", on)` |

A transaction-level seam exists at `kdrv_exp_i2c_xfer(addr, out, out_len, in, in_len, ms)`, `kdrv_exp_spi_xfer(out, in, len)` and `kdrv_exp_uart_write/read`; that is exactly the granularity this design uses (section 5.5).

---

## 2. Arduino on the web: decision (Part A.2)

### 2.1 Options

| | ArduinoCore-API (official) | pschatzmann/Arduino-Emulator | bxparks/EpoxyDuino |
|---|---|---|---|
| Source / commit | github.com/arduino/ArduinoCore-API `0f4e57e` (v1.5.2, `ARDUINO_API_VERSION 10502`) | `350f8da` | `72fc3c5` |
| Licence | LGPL-2.1, "or (at your option) any later version" in the headers, so it combines with GPL-3.0-or-later | LGPL-2.1 | MIT |
| What it is | the hardware-independent layer real cores build on: `Print`, `Stream`, `String`, `IPAddress`, pin enums, and the abstract `HardwareSerial`, `HardwareI2C` (with `begin(address)`, `onReceive`, `onRequest`), `HardwareSPI` | an emulator that gives a desktop Linux "core" on top of ArduinoCore-API (a git submodule): POSIX sockets, threads, signals, Ethernet/WiFi classes, remote GPIO/I2C/SPI over UDP, Raspberry Pi and FTDI back ends | a unix-host build of the Arduino API for unit tests (`cores/epoxy`), with its own `Print`, `WString` |
| Size | about 3.2 k lines | about 3.2 k lines of core `.cpp` plus headers | small |
| I2C slave | declared in the interface; we implement it | `RemoteI2C::onReceive/onRequest` are empty bodies (`ArduinoCore-Linux/cores/arduino/RemoteI2C.h:91-93`) | `Wire` is a mock, nothing happens (`README.md`: "stubbed out") |
| `delay()` | not defined (the core supplies it) | real sleep | `usleep(ms*1000)` (`cores/epoxy/Arduino.cpp:87-88`): real time, no virtual clock |
| Fits a no-WASI standalone module | yes (spike: zero WASI imports) | no: sockets, threads, filesystem | partly: its own copies of `Print`/`String` drift from the current API |

### 2.2 Decision

**Use ArduinoCore-API as the API layer and write a thin dotbench core ("dotcore") underneath it**, implementing the functions the API leaves to the core (`pinMode`, `digitalWrite`, `delay`, `millis`, `attachInterrupt`, ...), plus `Serial`, `Wire`, `SPI`, with ESP32 flavour on top (`ledc*`, `analogReadResolution`, `Preferences`, `ESP.*`). Reasons, all verified in the spike:

1. It is the real, versioned Arduino API; libraries written against `HardwareI2C`/`HardwareSerial`/`Stream` compile unchanged. Spike: 5 of its 8 `.cpp` files built as-is (`Print Stream String IPAddress Common`; the other three are CAN and PluggableUSB, not needed), blink is 2146 bytes and the I2C-slave sketch 11645 bytes.
2. The HAL boundary is small and is exactly our host interface (section 5), so there is one thing to specify and test.
3. Licence compatible with the project's GPL-3.0-or-later; keep the LGPL notices and ship the API sources (they are in the `.dotpart` build info and in the CLI).
4. The other two options would be replaced almost completely (EpoxyDuino: real-time sleep, no slave, API drift) or drag in a POSIX world that cannot run in a standalone wasm module (Arduino-Emulator). Its HAL class layout (`HardwareGPIO`, `HardwareSetup`) is a useful reference, nothing more.

Rejected: compiling the real arduino-esp32 core (it sits on ESP-IDF and FreeRTOS, the same problem the device runtime already solves for kode-sdk, ten times larger).

Pinned: ArduinoCore-API `0f4e57e`, Emscripten 7.0.0 (the device's toolchain), dotcore version `0.1` (spike), `ARDUINO=10819` and `ESP32` / `ARDUINO_ARCH_ESP32` defined so `#ifdef ESP32` blocks compile.

### 2.3 What ESP32 sketches need beyond the core API: first version vs stubs

| Feature | v1 | How |
|---|---|---|
| `pinMode` (INPUT, OUTPUT, INPUT_PULLUP, INPUT_PULLDOWN, OUTPUT_OPENDRAIN), `digitalWrite/Read`, `attachInterrupt` (RISING, FALLING, CHANGE), `IRAM_ATTR`, `digitalPinToInterrupt` | real | spike: core in place; interrupts delivered at yield points |
| `millis/micros/delay/delayMicroseconds/yield`, `esp_timer_get_time` | real | virtual clock, section 5.8; spike measured |
| `analogRead`, `analogReadResolution`, `analogReadMilliVolts`, `analogSetAttenuation` | real (attenuation ignored, 0..3.3 V full scale) | `adc_mv` op |
| `analogWrite`, `ledcAttach/ledcWrite/ledcSetup/ledcAttachPin/ledcWriteTone`, `tone/noTone` | real | PWM is a property of the net (hz, duty), not edges. `ledcWrite` resolution handled in dotcore (spike code in `dotcore.cpp`) |
| `dacWrite` | real | analog source on the pin (op `adc`'s dual: `drive_analog`) |
| `Serial` (console pane) and `Serial1/Serial2` (to pins with `begin(baud, config, rx, tx)`) | real | console is shown in the part's pane; UART ports go through the router |
| `Wire` master and slave, `Wire1`, ESP32 overloads (`begin(sda, scl, freq)`, `begin(addr, sda, scl, freq)`, `slaveWrite`, `setPins`) | real (spike: slave + master surface; master xfer returns NACK until the router exists) | mirrors arduino-esp32 overload resolution on purpose |
| `SPI` master (`begin(sck,miso,mosi,ss)`, `beginTransaction`, `transfer`) | real, not in spike | same mailbox pattern as I2C |
| `SPISlave` (ESP32SPISlave-style callback API) | v1.1 | needed for MCU parts that act as SPI devices |
| `Preferences` (NVS), `EEPROM` | v1: in-memory, persisted per instance in the bench layout (4 KB cap) | ops `nvs_get/nvs_set` |
| `String`, `Print`, `Stream`, `random`, `map`, `Serial.printf`, `ESP.restart()`, `ESP.getFreeHeap()` (fake), `esp_random()` | real | restart = new wasm instance (cold boot) |
| `Ticker`, `millis`-based schedulers | real | plain code |
| FreeRTOS (`xTaskCreate*`, queues, semaphores), `std::thread` | **unsupported**: compile error with a clear message | one Worker runs one `loop()`; cooperative tasks are a possible v2 |
| `WiFi`, `WiFiClient`, `HTTPClient`, `WebServer`, `WiFiClientSecure` | **stubs**: headers compile, `WiFi.status()` is `WL_NO_SHIELD`, `WiFi.begin` fails with a log line | v2 maps to the router's `wifi` wireless medium (station role) |
| BLE (`BLEDevice`, `NimBLE`) | **stubs**: compile, advertising is a no-op with a log line | v2 maps to the `ble` medium (peripheral role), needed for BLE sensor parts |
| `SD`, `SPIFFS`, `LittleFS` | stubs | v2 in-memory FS |
| NeoPixel (`neopixelWrite`, Adafruit_NeoPixel), DHT, OneWire, IR libraries | not in v1 | they are bit-timed single-wire protocols; v2 "frame protocols" (section 5.10) gives them a transaction-level path |
| `touchRead`, `hallRead`, I2S, RMT, CAN | not supported | |

---

## 3. Component package format: `.dotpart`

### 3.1 Container

A `.dotpart` is a ZIP file (stored or deflate; no encryption, no ZIP64, no symlinks, no absolute paths or `..`), media type `application/vnd.dotbench.part+zip`.

```
manifest.json         required, <= 128 KB, UTF-8, validated against manifest.schema.json
picture.png|webp|svg  required (the file named in manifest.picture.file), <= 1 MB
model.glb             optional (manifest.model.file), <= 4 MB, no external URIs
behaviour.wasm        when behaviour.type = "wasm" (manifest.behaviour.entry), <= 2 MB
src/**                optional but recommended: the Arduino/C/C++ sources and libraries/ the wasm was built from
README.md, LICENSE    optional
```

Limits (enforced while inflating, with a 100:1 ratio cap): 64 entries, 8 MB uncompressed in total, file names `[A-Za-z0-9._/-]{1,120}`. Anything else is ignored and reported as a warning in the import dialog; a path or size violation rejects the package. `.dotpart` files are immutable once built: their identity is `id` + `version` + SHA-256 of the file.

### 3.2 Manifest, field by field

Normative reference is the JSON Schema in 3.3 (also shipped as `templates/component-starter/manifest.schema.json`). Summary:

| Key | Req | Meaning |
|---|---|---|
| `schemaVersion` | yes | `1` |
| `id` | yes | reverse-DNS style, `^[a-z0-9]+([.-][a-z0-9]+){1,7}$`, max 80. `dotbench.` is reserved for built-ins |
| `name` | yes | localized object, `en` required, then `pt-BR`, `es` (max 48 chars each) |
| `version` | yes | semver |
| `author` | yes | `{name, url?}` |
| `license` | yes | SPDX expression (the manifest key is spelled `license`) |
| `description` | yes | localized, `en` required (max 1000 chars each); the "Make your own" checklist asks for `pt-BR` and `es` |
| `category`, `tags` | no | for the part picker |
| `picture` | yes | `{file, width, height}`: the pixel box that is the coordinate space for every `pos`, `region`, visual below |
| `model` | no | optional glTF binary for 3D view; `scale_mm` is the picture width in mm |
| `pins[]` | yes | terminals, see 3.2.1 |
| `wireless[]` | no | radio-type ports (NFC, 125 kHz RFID, BLE, Wi-Fi, IR), see 3.2.2 |
| `fields[]` | no | what the user edits in the property panel, see 3.2.3 |
| `controls[]` | no | direct manipulation on the picture (click, hold, drag) bound to a field |
| `outputs[]` | no | named values the part publishes to the UI and to tests |
| `visuals[]` | no | how the picture reacts: LED glow, text, rotation, bars, bound to a pin, a firmware GPIO, an output or a field |
| `behaviour` | yes | `wasm` or `declarative`, section 4 |
| `requires` | no | bench version range |
| `build` | no | written by the CLI: toolchain, dotcore and API versions, sources hash |

#### 3.2.1 Pins

Each pin is a **terminal** with an electrical kind:

| `kind` | Means |
|---|---|
| `io` | digital in/out terminal |
| `analog` | like `io`, and may be an analog source (DAC, sensor output) or be sensed |
| `power_in` | needs a supply: `min_mv`, `max_mv` required, `typ_ma` for the budget. The part is **off** until the net on this pin is in range **and** a `ground` pin of the part sits on the 0 V net |
| `power_out` | supplies a rail (`out_mv` required) |
| `ground` | 0 V reference |
| `nc` | decorative |

Other fields: `name` (`^[A-Za-z][A-Za-z0-9_]{0,23}$`, unique in the part), `label` (localized), `pos {x,y}` in picture pixels (centre of the pad; wires attach here), `gpio` (the Arduino pin number firmware uses, for `wasm` behaviour; pins without `gpio` are not addressable from firmware), `default` (state after power-up, before firmware runs: `z` default, `in`, `in_pullup`, `in_pulldown`, `out_low`, `out_high`), `pullup_ohms` / `pulldown_ohms` / `pull_rail` (resistors on the board, e.g. I2C pull-ups to the part's own supply), `series_ohms`, `abs_max_mv` (default 3600: above it the bench warns "5 V on a 3.3 V pin").

#### 3.2.2 Wireless ports

`{name, medium, role, range_mm?, pos?, config?}`. `medium` is `nfc_a`, `rfid_125k`, `ble`, `wifi` or `ir`; `role` per medium: nfc_a `target|initiator`, rfid_125k `tag|reader`, ble `peripheral|central`, wifi `ap|station`, ir `tx|rx`. `config` is opaque to this document and is validated by the stage that owns the medium (stage 2 for NFC/RFID, stage 3 for BLE/Wi-Fi, stage 4 for IR). A wireless port has no wires: the router links ports of the same medium and compatible roles that are within `range_mm` of each other on the bench canvas (default: any distance for wifi and ble, the object's `range_mm` otherwise).

#### 3.2.3 Fields

Types: `number`, `integer` (min, max, step, unit, `ui: input|slider|knob`), `boolean`, `enum` (`values[{value,label}]`, value number or string), `string` (maxLength 256), `bytes` (hex string, max 256 bytes, e.g. a UID), `color`. Every field has `name` (`^[a-z][a-z0-9_]{0,31}$`), a localized `label` and a `default`. Fields change **while the part runs**: wasm parts read them with `dotbenchField(FIELD_X)` (always the current value), declarative parts use them in expressions.

### 3.3 JSON Schema (draft 2020-12), complete

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://dotbench.app/schema/dotpart-1.json",
  "title": "dotbench component manifest, schemaVersion 1",
  "type": "object",
  "required": ["schemaVersion", "id", "name", "version", "author", "license", "description", "picture", "pins", "behaviour"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "schemaVersion": { "const": 1 },
    "id": { "type": "string", "pattern": "^[a-z0-9]+([.-][a-z0-9]+){1,7}$", "maxLength": 80,
            "description": "Globally unique, reverse-DNS style. The prefix dotbench. is reserved for built-in parts." },
    "name": { "$ref": "#/$defs/localizedShort" },
    "version": { "type": "string", "pattern": "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z.-]+)?$" },
    "author": { "type": "object", "required": ["name"], "additionalProperties": false,
      "properties": { "name": { "type": "string", "minLength": 1, "maxLength": 80 },
                      "url": { "type": "string", "format": "uri", "maxLength": 200 } } },
    "license": { "type": "string", "minLength": 1, "maxLength": 80, "description": "SPDX license expression, e.g. MIT, GPL-3.0-or-later, CC-BY-4.0, LicenseRef-Proprietary." },
    "description": { "$ref": "#/$defs/localizedLong" },
    "category": { "enum": ["sensor", "actuator", "display", "input", "mcu", "wireless", "module", "other"], "default": "other" },
    "tags": { "type": "array", "maxItems": 12, "items": { "type": "string", "pattern": "^[a-z0-9-]{1,24}$" } },
    "picture": { "type": "object", "required": ["file", "width", "height"], "additionalProperties": false,
      "properties": {
        "file": { "type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,80}\\.(png|webp|svg)$" },
        "width": { "type": "integer", "minimum": 32, "maximum": 2048 },
        "height": { "type": "integer", "minimum": 32, "maximum": 2048 } },
      "description": "width/height define the coordinate space used by every pos, region and visual in this manifest." },
    "model": { "type": "object", "required": ["file"], "additionalProperties": false,
      "properties": { "file": { "type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,80}\\.glb$" },
                      "scale_mm": { "type": "number", "exclusiveMinimum": 0, "description": "Width of the picture in millimetres, to size the 3D model." } } },
    "pins": { "type": "array", "minItems": 1, "maxItems": 64, "items": { "$ref": "#/$defs/pin" } },
    "wireless": { "type": "array", "maxItems": 4, "items": { "$ref": "#/$defs/wirelessPort" } },
    "fields": { "type": "array", "maxItems": 32, "items": { "$ref": "#/$defs/field" } },
    "controls": { "type": "array", "maxItems": 32, "items": { "$ref": "#/$defs/control" } },
    "outputs": { "type": "array", "maxItems": 32, "items": { "$ref": "#/$defs/output" } },
    "visuals": { "type": "array", "maxItems": 64, "items": { "$ref": "#/$defs/visual" } },
    "behaviour": { "oneOf": [ { "$ref": "#/$defs/behaviourWasm" }, { "$ref": "#/$defs/behaviourDeclarative" } ] },
    "requires": { "type": "object", "additionalProperties": false,
      "properties": { "dotbench": { "type": "string", "maxLength": 40, "description": "Semver range of the bench, e.g. >=1.0.0" } } },
    "build": { "type": "object", "description": "Written by `dotbench part build`. Do not edit.",
      "additionalProperties": false,
      "properties": { "toolchain": { "type": "string" }, "dotcore": { "type": "string" }, "api": { "type": "string" },
                      "sources_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" } } }
  },
  "$defs": {
    "locale": { "type": "string", "pattern": "^[a-z]{2}(-[A-Z]{2})?$" },
    "localizedShort": { "type": "object", "required": ["en"], "propertyNames": { "$ref": "#/$defs/locale" },
      "additionalProperties": { "type": "string", "minLength": 1, "maxLength": 48 } },
    "localizedLong": { "type": "object", "required": ["en"], "propertyNames": { "$ref": "#/$defs/locale" },
      "additionalProperties": { "type": "string", "minLength": 1, "maxLength": 1000 },
      "description": "en is required; pt-BR and es are expected by the Make your own checklist." },
    "pinName": { "type": "string", "pattern": "^[A-Za-z][A-Za-z0-9_]{0,23}$" },
    "fieldName": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,31}$" },
    "color": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" },
    "point": { "type": "object", "required": ["x", "y"], "additionalProperties": false,
      "properties": { "x": { "type": "number", "minimum": 0, "maximum": 2048 }, "y": { "type": "number", "minimum": 0, "maximum": 2048 } } },
    "region": { "type": "object", "required": ["x", "y", "w", "h"], "additionalProperties": false,
      "properties": { "x": { "type": "number", "minimum": 0 }, "y": { "type": "number", "minimum": 0 },
                      "w": { "type": "number", "exclusiveMinimum": 0 }, "h": { "type": "number", "exclusiveMinimum": 0 } } },
    "pin": { "type": "object", "required": ["name", "kind", "pos"], "additionalProperties": false,
      "properties": {
        "name": { "$ref": "#/$defs/pinName" },
        "kind": { "enum": ["io", "analog", "power_in", "power_out", "ground", "nc"],
                  "description": "io: digital in/out. analog: also an analog source or sense. power_in: needs a supply. power_out: supplies a rail. ground: 0 V reference. nc: decorative." },
        "label": { "$ref": "#/$defs/localizedShort" },
        "gpio": { "type": "integer", "minimum": 0, "maximum": 255, "description": "The Arduino pin number firmware uses for this terminal (wasm behaviour only)." },
        "pos": { "$ref": "#/$defs/point" },
        "default": { "enum": ["z", "in", "in_pullup", "in_pulldown", "out_low", "out_high"], "default": "z", "description": "State after power-up, before firmware runs." },
        "pullup_ohms":   { "type": "number", "minimum": 100, "maximum": 10000000 },
        "pulldown_ohms": { "type": "number", "minimum": 100, "maximum": 10000000 },
        "pull_rail": { "$ref": "#/$defs/pinName", "description": "Name of the power_in/power_out pin of this part a pull-up goes to. Defaults to the first power_in pin." },
        "series_ohms": { "type": "number", "minimum": 0, "maximum": 100000, "default": 0 },
        "abs_max_mv": { "type": "integer", "minimum": 0, "maximum": 60000, "default": 3600, "description": "Voltage above which the bench shows an over-voltage warning." },
        "min_mv": { "type": "integer", "description": "power_in: lowest supply voltage at which the part runs." },
        "max_mv": { "type": "integer", "description": "power_in: highest supply voltage the part tolerates." },
        "typ_ma": { "type": "number", "minimum": 0, "description": "power_in: typical current, shown against the 5 V budget (0.5 A on the Kode Dot)." },
        "out_mv": { "type": "integer", "description": "power_out: the voltage it supplies." }
      },
      "allOf": [
        { "if": { "properties": { "kind": { "const": "power_in" } }, "required": ["kind"] }, "then": { "required": ["min_mv", "max_mv"] } },
        { "if": { "properties": { "kind": { "const": "power_out" } }, "required": ["kind"] }, "then": { "required": ["out_mv"] } }
      ] },
    "wirelessPort": { "type": "object", "required": ["name", "medium", "role"], "additionalProperties": false,
      "properties": {
        "name": { "$ref": "#/$defs/pinName" },
        "medium": { "enum": ["nfc_a", "rfid_125k", "ble", "wifi", "ir"] },
        "role": { "type": "string", "pattern": "^[a-z_]{2,24}$", "description": "Valid roles per medium: nfc_a target|initiator, rfid_125k tag|reader, ble peripheral|central, wifi ap|station, ir tx|rx." },
        "range_mm": { "type": "number", "minimum": 0, "maximum": 100000 },
        "pos": { "$ref": "#/$defs/point" },
        "config": { "type": "object", "description": "Medium-specific; validated by the stage that owns the medium." }
      } },
    "field": { "oneOf": [
      { "type": "object", "required": ["name", "type", "label", "default"], "additionalProperties": false,
        "properties": { "name": { "$ref": "#/$defs/fieldName" }, "type": { "enum": ["number", "integer"] }, "label": { "$ref": "#/$defs/localizedShort" },
          "min": { "type": "number" }, "max": { "type": "number" }, "step": { "type": "number", "exclusiveMinimum": 0 },
          "unit": { "type": "string", "maxLength": 8 }, "default": { "type": "number" },
          "ui": { "enum": ["input", "slider", "knob"], "default": "input" }, "advanced": { "type": "boolean" } } },
      { "type": "object", "required": ["name", "type", "label", "default"], "additionalProperties": false,
        "properties": { "name": { "$ref": "#/$defs/fieldName" }, "type": { "const": "boolean" }, "label": { "$ref": "#/$defs/localizedShort" },
          "default": { "type": "boolean" }, "advanced": { "type": "boolean" } } },
      { "type": "object", "required": ["name", "type", "label", "default", "values"], "additionalProperties": false,
        "properties": { "name": { "$ref": "#/$defs/fieldName" }, "type": { "const": "enum" }, "label": { "$ref": "#/$defs/localizedShort" },
          "default": { "type": ["number", "string"] },
          "values": { "type": "array", "minItems": 2, "maxItems": 32, "items": { "type": "object", "required": ["value", "label"], "additionalProperties": false,
            "properties": { "value": { "type": ["number", "string"] }, "label": { "$ref": "#/$defs/localizedShort" } } } },
          "advanced": { "type": "boolean" } } },
      { "type": "object", "required": ["name", "type", "label", "default"], "additionalProperties": false,
        "properties": { "name": { "$ref": "#/$defs/fieldName" }, "type": { "const": "string" }, "label": { "$ref": "#/$defs/localizedShort" },
          "default": { "type": "string", "maxLength": 256 }, "maxLength": { "type": "integer", "minimum": 1, "maximum": 256 },
          "pattern": { "type": "string", "maxLength": 120 }, "advanced": { "type": "boolean" } } },
      { "type": "object", "required": ["name", "type", "label", "default"], "additionalProperties": false,
        "properties": { "name": { "$ref": "#/$defs/fieldName" }, "type": { "const": "bytes" }, "label": { "$ref": "#/$defs/localizedShort" },
          "default": { "type": "string", "pattern": "^([0-9a-fA-F]{2})*$", "maxLength": 512, "description": "Hex string, e.g. a tag UID." },
          "max_bytes": { "type": "integer", "minimum": 1, "maximum": 256 }, "advanced": { "type": "boolean" } } },
      { "type": "object", "required": ["name", "type", "label", "default"], "additionalProperties": false,
        "properties": { "name": { "$ref": "#/$defs/fieldName" }, "type": { "const": "color" }, "label": { "$ref": "#/$defs/localizedShort" },
          "default": { "$ref": "#/$defs/color" }, "advanced": { "type": "boolean" } } }
    ] },
    "control": { "type": "object", "required": ["field", "region", "mode"], "additionalProperties": false,
      "properties": { "field": { "$ref": "#/$defs/fieldName" }, "region": { "$ref": "#/$defs/region" },
                      "mode": { "enum": ["toggle", "momentary", "drag_x", "drag_y", "rotate"] }, "label": { "$ref": "#/$defs/localizedShort" } } },
    "output": { "type": "object", "required": ["name", "type"], "additionalProperties": false,
      "properties": { "name": { "$ref": "#/$defs/fieldName" }, "type": { "enum": ["number", "boolean"] },
                      "unit": { "type": "string", "maxLength": 8 }, "min": { "type": "number" }, "max": { "type": "number" },
                      "label": { "$ref": "#/$defs/localizedShort" } } },
    "visual": { "type": "object", "required": ["id", "effect", "source"], "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,23}$" },
        "effect": { "enum": ["glow", "fill", "rotate", "opacity", "text", "bar"] },
        "x": { "type": "number" }, "y": { "type": "number" }, "w": { "type": "number" }, "h": { "type": "number" }, "r": { "type": "number" },
        "color": { "$ref": "#/$defs/color" },
        "source": { "oneOf": [
          { "type": "object", "required": ["pin"], "additionalProperties": false, "properties": { "pin": { "$ref": "#/$defs/pinName" } } },
          { "type": "object", "required": ["gpio"], "additionalProperties": false, "properties": { "gpio": { "type": "integer", "minimum": 0, "maximum": 255 } },
            "description": "A firmware pin with no terminal (an on-board LED)." },
          { "type": "object", "required": ["output"], "additionalProperties": false, "properties": { "output": { "$ref": "#/$defs/fieldName" } } },
          { "type": "object", "required": ["field"], "additionalProperties": false, "properties": { "field": { "$ref": "#/$defs/fieldName" } } } ] },
        "scale": { "type": "object", "required": ["in", "out"], "additionalProperties": false,
          "properties": { "in": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 },
                          "out": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 } } }
      } },
    "behaviourWasm": { "type": "object", "required": ["type", "entry", "abi"], "additionalProperties": false,
      "properties": {
        "type": { "const": "wasm" },
        "entry": { "type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9._/-]{1,80}\\.wasm$" },
        "abi": { "const": 1 },
        "memory_kb": { "type": "integer", "minimum": 256, "maximum": 8192, "default": 1024 },
        "stack_kb": { "type": "integer", "minimum": 16, "maximum": 512, "default": 64 },
        "wasm_sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "sources": { "type": "array", "maxItems": 64, "items": { "type": "string", "maxLength": 120 }, "description": "Informational: source files shipped under src/." }
      } },
    "expr": { "oneOf": [
      { "type": ["number", "boolean", "string"] },
      { "type": "object", "required": ["field"], "additionalProperties": false,
        "properties": { "field": { "$ref": "#/$defs/fieldName" }, "scale": { "type": "number" }, "offset": { "type": "number" } } },
      { "type": "object", "required": ["field", "op", "value"], "additionalProperties": false,
        "properties": { "field": { "$ref": "#/$defs/fieldName" }, "op": { "enum": ["eq", "ne", "gt", "ge", "lt", "le"] }, "value": { "type": ["number", "boolean", "string"] } } } ] },
    "behaviourDeclarative": { "type": "object", "required": ["type", "engine", "elements"], "additionalProperties": false,
      "properties": { "type": { "const": "declarative" }, "engine": { "const": 1 },
                      "elements": { "type": "array", "minItems": 1, "maxItems": 64, "items": { "$ref": "#/$defs/element" } } } },
    "element": { "oneOf": [
      { "type": "object", "required": ["type", "a", "b", "closed"], "additionalProperties": false,
        "properties": { "type": { "const": "switch" }, "a": { "$ref": "#/$defs/pinName" }, "b": { "$ref": "#/$defs/pinName" }, "closed": { "$ref": "#/$defs/expr" },
                        "bounce_ms": { "type": "number", "minimum": 0, "maximum": 20 } } },
      { "type": "object", "required": ["type", "a", "b"], "additionalProperties": false,
        "properties": { "type": { "const": "bridge" }, "a": { "$ref": "#/$defs/pinName" }, "b": { "$ref": "#/$defs/pinName" } } },
      { "type": "object", "required": ["type", "top", "bottom", "wiper", "ohms", "position"], "additionalProperties": false,
        "properties": { "type": { "const": "divider" }, "top": { "$ref": "#/$defs/pinName" }, "bottom": { "$ref": "#/$defs/pinName" }, "wiper": { "$ref": "#/$defs/pinName" },
                        "ohms": { "type": "number", "minimum": 100 }, "position": { "$ref": "#/$defs/expr" } } },
      { "type": "object", "required": ["type", "pin", "mv"], "additionalProperties": false,
        "properties": { "type": { "const": "source" }, "pin": { "$ref": "#/$defs/pinName" }, "mv": { "$ref": "#/$defs/expr" },
                        "ohms": { "type": "number", "minimum": 1, "default": 100 } } },
      { "type": "object", "required": ["type", "pin", "level"], "additionalProperties": false,
        "properties": { "type": { "const": "drive" }, "pin": { "$ref": "#/$defs/pinName" }, "mode": { "enum": ["push_pull", "open_drain"], "default": "push_pull" },
                        "level": { "$ref": "#/$defs/expr" } } },
      { "type": "object", "required": ["type", "sda", "scl", "address", "registers"], "additionalProperties": false,
        "properties": { "type": { "const": "i2c_slave" }, "sda": { "$ref": "#/$defs/pinName" }, "scl": { "$ref": "#/$defs/pinName" },
          "address": { "oneOf": [ { "type": "integer", "minimum": 8, "maximum": 119 }, { "type": "object", "required": ["field"], "additionalProperties": false, "properties": { "field": { "$ref": "#/$defs/fieldName" } } } ] },
          "pointer_bytes": { "enum": [0, 1], "default": 1, "description": "1: first written byte selects the register. 0: no pointer, a read returns register 0." },
          "auto_increment": { "type": "boolean", "default": true },
          "registers": { "type": "array", "minItems": 1, "maxItems": 64, "items": { "type": "object", "required": ["reg", "size", "access"], "additionalProperties": false,
            "properties": { "reg": { "type": "integer", "minimum": 0, "maximum": 255 }, "size": { "type": "integer", "minimum": 1, "maximum": 4 },
              "access": { "enum": ["ro", "rw"] }, "default": { "type": "integer", "minimum": 0 },
              "value": { "type": "object", "required": ["field"], "additionalProperties": false,
                "properties": { "field": { "$ref": "#/$defs/fieldName" }, "scale": { "type": "number", "default": 1 }, "offset": { "type": "number", "default": 0 },
                                "signed": { "type": "boolean", "default": false }, "endian": { "enum": ["big", "little"], "default": "big" },
                                "left_align_bits": { "type": "integer", "minimum": 0, "maximum": 16, "default": 0, "description": "Shift left, for registers whose low bits are unused (LM75: 7)." } } } } } } } },
      { "type": "object", "required": ["type", "in1", "in2", "output"], "additionalProperties": false,
        "properties": { "type": { "const": "h_bridge" }, "in1": { "$ref": "#/$defs/pinName" }, "in2": { "$ref": "#/$defs/pinName" },
                        "output": { "$ref": "#/$defs/fieldName", "description": "Name of an outputs[] entry that receives speed in -1..1." },
                        "enable": { "$ref": "#/$defs/pinName", "description": "Optional nSLEEP-style pin that must read high." } } },
      { "type": "object", "required": ["type", "pin", "output"], "additionalProperties": false,
        "properties": { "type": { "const": "servo" }, "pin": { "$ref": "#/$defs/pinName" }, "output": { "$ref": "#/$defs/fieldName" },
                        "min_us": { "type": "number", "default": 1000 }, "max_us": { "type": "number", "default": 2000 },
                        "range_deg": { "type": "number", "default": 180 } } },
      { "type": "object", "required": ["type", "port"], "additionalProperties": false,
        "properties": { "type": { "const": "wireless" }, "port": { "$ref": "#/$defs/pinName" },
                        "config": { "type": "object", "description": "Medium-specific; may use { \"field\": name } values." } } }
    ] }
  }
}
```

### 3.4 Two complete manifests

**(a) Programmable part: an ESP32 running Arduino code.** This is `templates/component-starter/manifest.json` and its sketch `src/main.ino`; it builds and passes `tests/sensor.test.json` in the spike.

```json
{
  "$schema": "./manifest.schema.json",
  "schemaVersion": 1,
  "id": "com.example.esp32-lm75",
  "name": {
    "en": "ESP32 temperature sensor",
    "pt-BR": "Sensor de temperatura ESP32",
    "es": "Sensor de temperatura ESP32"
  },
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "url": "https://example.com"
  },
  "license": "MIT",
  "description": {
    "en": "An ESP32 running real Arduino code that behaves like an LM75 temperature sensor on I2C. Set the temperature in the property panel; the Kode Dot reads it with kode_i2c_write_read().",
    "pt-BR": "Um ESP32 rodando código Arduino de verdade que se comporta como um sensor de temperatura LM75 no I2C. Ajuste a temperatura no painel; o Kode Dot lê com kode_i2c_write_read().",
    "es": "Un ESP32 que ejecuta código Arduino real y se comporta como un sensor de temperatura LM75 en I2C. Ajusta la temperatura en el panel; el Kode Dot la lee con kode_i2c_write_read()."
  },
  "category": "mcu",
  "tags": [
    "esp32",
    "i2c",
    "sensor",
    "arduino"
  ],
  "picture": {
    "file": "picture.svg",
    "width": 400,
    "height": 260
  },
  "pins": [
    {
      "name": "V33",
      "kind": "power_in",
      "pos": {
        "x": 40,
        "y": 238
      },
      "label": {
        "en": "3V3"
      },
      "min_mv": 3000,
      "max_mv": 3600,
      "typ_ma": 40
    },
    {
      "name": "GND",
      "kind": "ground",
      "pos": {
        "x": 100,
        "y": 238
      },
      "label": {
        "en": "GND"
      }
    },
    {
      "name": "SDA",
      "kind": "io",
      "gpio": 21,
      "pos": {
        "x": 160,
        "y": 238
      },
      "label": {
        "en": "SDA"
      },
      "abs_max_mv": 3600
    },
    {
      "name": "SCL",
      "kind": "io",
      "gpio": 22,
      "pos": {
        "x": 220,
        "y": 238
      },
      "label": {
        "en": "SCL"
      },
      "abs_max_mv": 3600
    },
    {
      "name": "INT",
      "kind": "io",
      "gpio": 4,
      "pos": {
        "x": 280,
        "y": 238
      },
      "label": {
        "en": "INT"
      },
      "abs_max_mv": 3600
    }
  ],
  "fields": [
    {
      "name": "temperature",
      "type": "number",
      "label": {
        "en": "Temperature",
        "pt-BR": "Temperatura",
        "es": "Temperatura"
      },
      "min": -40,
      "max": 125,
      "step": 0.25,
      "unit": "°C",
      "default": 22.5,
      "ui": "slider"
    },
    {
      "name": "address",
      "type": "enum",
      "label": {
        "en": "I2C address",
        "pt-BR": "Endereço I2C",
        "es": "Dirección I2C"
      },
      "default": 72,
      "values": [
        {
          "value": 72,
          "label": {
            "en": "0x48"
          }
        },
        {
          "value": 73,
          "label": {
            "en": "0x49"
          }
        },
        {
          "value": 74,
          "label": {
            "en": "0x4A"
          }
        },
        {
          "value": 75,
          "label": {
            "en": "0x4B"
          }
        }
      ]
    }
  ],
  "outputs": [
    {
      "name": "reads",
      "type": "number",
      "label": {
        "en": "Reads served",
        "pt-BR": "Leituras atendidas",
        "es": "Lecturas atendidas"
      }
    }
  ],
  "visuals": [
    {
      "id": "act_led",
      "effect": "glow",
      "x": 330,
      "y": 60,
      "r": 9,
      "color": "#3ddc84",
      "source": {
        "gpio": 2
      }
    },
    {
      "id": "reads_text",
      "effect": "text",
      "x": 200,
      "y": 150,
      "w": 160,
      "h": 30,
      "source": {
        "output": "reads"
      }
    }
  ],
  "behaviour": {
    "type": "wasm",
    "entry": "behaviour.wasm",
    "abi": 1,
    "memory_kb": 1024,
    "stack_kb": 64,
    "sources": [
      "src/main.ino"
    ]
  }
}
```

**(b) Declarative part: the same sensor as a fixed-function breakout with no code** (`templates/component-starter/examples/lm75-declarative.manifest.json`).

```json
{
  "$schema": "../manifest.schema.json",
  "schemaVersion": 1,
  "id": "com.example.lm75-breakout",
  "name": { "en": "LM75 temperature breakout", "pt-BR": "Módulo de temperatura LM75", "es": "Módulo de temperatura LM75" },
  "version": "1.0.0",
  "author": { "name": "Your Name" },
  "license": "MIT",
  "description": {
    "en": "A fixed-function I2C temperature sensor with on-board pull-ups. No code: its registers come from the manifest.",
    "pt-BR": "Um sensor de temperatura I2C de função fixa, com pull-ups na placa. Sem código: os registradores vêm do manifesto.",
    "es": "Un sensor de temperatura I2C de función fija, con pull-ups en la placa. Sin código: los registros vienen del manifiesto."
  },
  "category": "sensor",
  "picture": { "file": "picture-lm75.svg", "width": 240, "height": 160 },
  "pins": [
    { "name": "VCC", "kind": "power_in", "pos": { "x": 30,  "y": 140 }, "min_mv": 2800, "max_mv": 5500, "typ_ma": 0.3 },
    { "name": "GND", "kind": "ground",   "pos": { "x": 90,  "y": 140 } },
    { "name": "SDA", "kind": "io", "pos": { "x": 150, "y": 140 }, "pullup_ohms": 10000, "pull_rail": "VCC", "abs_max_mv": 5500 },
    { "name": "SCL", "kind": "io", "pos": { "x": 210, "y": 140 }, "pullup_ohms": 10000, "pull_rail": "VCC", "abs_max_mv": 5500 }
  ],
  "fields": [
    { "name": "temperature", "type": "number", "label": { "en": "Temperature", "pt-BR": "Temperatura", "es": "Temperatura" },
      "min": -55, "max": 125, "step": 0.5, "unit": "°C", "default": 25, "ui": "slider" },
    { "name": "address", "type": "enum", "label": { "en": "I2C address", "pt-BR": "Endereço I2C", "es": "Dirección I2C" }, "default": 72,
      "values": [ { "value": 72, "label": { "en": "0x48" } }, { "value": 73, "label": { "en": "0x49" } } ] }
  ],
  "visuals": [
    { "id": "power_led", "effect": "glow", "x": 120, "y": 40, "r": 8, "color": "#ff3b30", "source": { "pin": "VCC" } }
  ],
  "behaviour": {
    "type": "declarative", "engine": 1,
    "elements": [
      { "type": "i2c_slave", "sda": "SDA", "scl": "SCL", "address": { "field": "address" }, "pointer_bytes": 1, "auto_increment": false,
        "registers": [
          { "reg": 0, "size": 2, "access": "ro", "value": { "field": "temperature", "scale": 256, "signed": true, "endian": "big" } },
          { "reg": 1, "size": 1, "access": "rw", "default": 0 },
          { "reg": 2, "size": 2, "access": "rw", "default": 19200 },
          { "reg": 3, "size": 2, "access": "rw", "default": 20480 }
        ] }
    ]
  }
}
```

Two smaller declarative examples live next to it: `examples/button-module.manifest.json` (a momentary switch between two terminals).

---

## 4. Behaviour: two entry points, one host interface

`manifest.behaviour.type` is one of:

### 4.1 `wasm`: real firmware

A WebAssembly module produced by `dotbench part build` from Arduino (`.ino`), C or C++ sources. It is a **standalone module with no JavaScript glue and no WASI**: its only imports are the `dotbench.*` functions of ABI 1 (section 5.9), its exports are a fixed list. The runtime instantiates it in a dedicated Worker (section 5.9) and calls `_initialize()` then `dp_start()`, which runs `setup()` and then `loop()` forever (the spike's `dotcore.cpp`). Power off kills the Worker; power on creates a fresh instance (cold boot, `millis()` restarts at 0).

### 4.2 `declarative`: no code

For passive and fixed-function parts. The manifest carries a list of **elements** (engine 1). There is no scripting: values come from fields through `expr` (a literal, `{field, scale, offset}`, or a comparison `{field, op, value}`).

| Element | What it does | Fields used |
|---|---|---|
| `switch` | joins terminals `a` and `b` while `closed` is true (a momentary button, a DIP switch); `bounce_ms` makes the closing produce up to 20 alternating edges instead of one clean edge | boolean field |
| `bridge` | permanent connection of two of the part's terminals (a pass-through header on a module) | none |
| `divider` | potentiometer: `top`, `bottom`, `wiper`, total `ohms`, `position` 0..1; the wiper is a Thevenin source between the voltages of the other two pins with series resistance `R*p*(1-p)` | number field |
| `source` | analog output: `mv` through `ohms` (default 100): an analog sensor | number field |
| `drive` | digital output, push-pull or open-drain, level from an `expr` (an interrupt line that goes low when a field condition holds) | any |
| `i2c_slave` | register-file I2C target: address (number or field), pointer byte, `auto_increment`, registers of 1 to 4 bytes, `ro`/`rw`, a value from a field (`scale`, `signed`, `endian`) or a stored default | number/enum fields |
| `h_bridge` | dual-input motor driver output: reads `in1` and `in2` (level or PWM duty) and publishes signed speed (-1..1) to an `outputs[]` entry; optional `enable` pin | none |
| `servo` | reads PWM pulse width on `pin` (duty/hz), publishes the angle to an `outputs[]` entry | none |
| `wireless` | binds a `wireless[]` port to its medium behaviour (an NFC tag whose UID and NDEF text come from fields); `config` is owned by the medium's stage | fields |

All elements follow the same power rule as code (an unpowered part does nothing). The declarative runner is **a JavaScript implementation of the same host interface** (it is an endpoint like any other, section 5.2); it lives inside the router's Worker, so declarative parts cost no extra Worker. The test for "the format works" is that the same part can be expressed either way: section 3.4 shows both versions of the LM75.

### 4.3 Why there is no user-written JavaScript behaviour

1. **The owner asked for real firmware code**: the same source that runs on a real ESP32, so that a part written here is a part you can flash. JavaScript behaviour would teach something that does not transfer.
2. **Isolation.** A wasm module has no ambient authority: no `fetch`, no IndexedDB, no `postMessage`, no `importScripts`, no DOM, no clock. It can only call the `dotbench.*` imports we hand it, and the loader refuses a module that imports anything else (section 8). Arbitrary JavaScript in a Worker can do all of those things; making it safe means a second sandbox (SES realms or opaque-origin iframes) and a policy for every global.
3. **Determinism.** Wasm cannot read `Date.now()`, `performance.now()` or `setTimeout`; time comes only from the bench clock, so stepping, pausing and speed changes are exact. JavaScript would bypass all of it.
4. **Hidden-tab behaviour.** A blocking wasm Worker is not subject to the main-thread timer throttling that JavaScript event-loop code is exposed to.

**The door stays open technically.** The host interface (section 5) is a list of operations with defined semantics, independent of how they are called. `behaviour.type: "js"` is reserved and the schema rejects it today; a future JS binding would implement the same operations over the same mailbox in a locked-down Worker (SES, no `fetch`, `connect-src 'none'`), enabled only by an explicit "allow JavaScript parts" setting and a stronger import warning. Nothing in the manifest, the router or the net model would change.

---

## 5. The host interface and the bench model

### 5.1 Terminals, parts and nets

- Every part instance has an id (`p1`, `p2`, ...; the device is the reserved instance `device`). A **terminal** is `<instance>.<pin>`: `device.EXP4`, `p1.SDA`. Rails are terminals too: `device.V33`, `device.V5`, `device.GND`.
- A **wire** joins two terminals. A **net** is a connected set of terminals (union-find over wires, over `bridge` elements, and over `switch` elements while closed). **Every terminal is in a net, even when unwired** (a singleton net), so a floating input with its own pull-up still resolves.
- All `ground` terminals, wired or not, are the same reference net `GND` (0 V). A part whose ground pin is not wired to `GND` is unpowered. This is what makes "forgot to wire GND" visible instead of silently working.
- Wires are added and removed while everything runs. Each change re-solves the affected nets (5.3), then re-evaluates part power (5.7).

### 5.2 Endpoints and the messages between them

Three kinds of **endpoint** exist: the **device** (the wasm app's fake drivers, written by the runtime engineer), a **wasm part** (a Worker), a **declarative part** (JS inside the router's Worker). All speak the same messages. TypeScript sketch, normative for names and meaning:

```ts
type Term = string;                         // "device.EXP4", "p1.SDA"
type Pull = 'none' | 'up' | 'down';

// What an endpoint publishes about ONE of its terminals. Everything is DC and instantaneous.
type Drive =
  | { mode: 'z';      pull: Pull; pullOhms?: number }                       // high impedance (+ optional pull); input
  | { mode: 'out';    level: 0 | 1; pull: Pull }                            // push-pull
  | { mode: 'od';     level: 0 | 1; pull: Pull }                            // open-drain: 0 pulls low, 1 releases
  | { mode: 'pwm';    hz: number; dutyQ16: number }                         // 0..65536, a property of the net
  | { mode: 'analog'; mv: number; ohms: number };                           // Thevenin source (sensor, DAC, wiper)

// endpoint -> router
interface ToRouter {
  drive(term: Term, d: Drive, t: bigint): void;                   // t = virtual microseconds when it happened
  watch(term: Term, kind: 'rise' | 'fall' | 'change' | 'none'): void;   // ask for edge events
  busOpen(b: BusOpen): void;  busClose(id: string): void;         // announce an I2C/SPI/UART role (5.5)
  xfer(x: MasterXfer, reply: (r: XferResult) => void): void;      // a master starts a transaction
  uartTx(port: string, bytes: Uint8Array, t: bigint): void;
  setRail(rail: 'V33' | 'V5', on: boolean): void;                 // device only
  output(name: string, v: number | boolean, t: bigint): void;     // value for the UI / tests
  log(level: 0 | 1 | 2 | 3, text: string): void;                  // the part's console
}

// router -> endpoint
interface FromRouter {
  power(on: boolean): void;                                       // a part is created/destroyed on this, see 5.7
  edge(term: Term, level: 0 | 1, t: bigint): void;                // t = when the net actually changed
  i2cSlave(x: { addr: number; w: Uint8Array; rlen: number; hz: number }): { ack: boolean; r: Uint8Array };
  spiSlave(x: { mode: 0 | 1 | 2 | 3; hz: number; w: Uint8Array }): { r: Uint8Array };
  uartRx(port: string, bytes: Uint8Array, arriveAt: bigint[]): void;   // per-byte arrival times
  field(name: string, v: number | string | boolean): void;
  wirelessRequest(port: string, req: Uint8Array): Uint8Array;     // medium-defined payload
}
```

The device endpoint maps the fake drivers of section 1.3 onto `ToRouter`:

| Device seam | Message |
|---|---|
| `khal_gpio_input(gpio, pull)` | `drive(EXPn, {mode:'z', pull})` (`kode_pin_read` and `kode_pin_write` go through `khal_exp_input/output`) |
| `khal_gpio_output(gpio, level)`, `khal_gpio_write` | `drive(EXPn, {mode:'out', level, pull:'none'})` |
| `khal_gpio_level(gpio)` | read `NetTable.level[net(EXPn)]` (5.9.2), no message |
| `khal_gpio_irq_attach(gpio, kind, cb)` | `watch(EXPn, ...)`; `edge()` calls `cb` (the real kode layer adds its own 30 ms settle) |
| `khal_pwm_set(ch, hz, duty_x10)` | `drive(EXPn, {mode:'pwm', hz, dutyQ16: duty_x10*65536/1000})` |
| `khal_exp_port_adc_read(chan, ...)` | read `NetTable.mv[net]`; `raw = min(4095, round(mv*4095/3100))`, `calibrated = true` (ADC full scale 3100 mV is the SDK example's constant, flagged in bench-spec Q3) |
| `kdrv_exp_i2c_open(ctrl, sda_gpio, scl_gpio, hz)` | `busOpen({kind:'i2c', role:'master', id:'device.i2c', sda:EXPa, scl:EXPb, hz})` and `drive(SDA/SCL, {mode:'z', pull:'up'})` (the SDK enables internal pull-ups) |
| `kdrv_exp_i2c_xfer`, `kdrv_exp_i2c_probe` | `xfer({kind:'i2c', ...})`; the driver then waits `bytes*9/hz` of virtual time before returning, so timing looks real |
| `kdrv_exp_spi_*`, `kdrv_exp_uart_*` | the same pattern (5.5) |
| `kode_sys_exp_power(on)`, `kode_pin_power_3v3`, `kode_pin_power_5v` | `setRail('V33'|'V5', on)` |

### 5.3 Net solver (resistive, DC, no time)

The router keeps for every terminal its last `Drive` and recomputes a net whenever one of its terminals changes, wires change, or a part's power changes. Per net:

1. **Collect sources** `(mv, ohms)` from every terminal in it:
   - `out` level L: `mv = L ? Vhigh : 0`, `ohms = 50 + series_ohms` (the device's EXP terminals carry 68 ohm series, so 118; a part's pins use their `series_ohms`). `Vhigh` is the voltage of the net on the owner's `power_in` pin (a part powered from 5 V drives 5 V high). The device's `Vhigh` is 3300.
   - `od` level 0: `(0, 50 + series)`; level 1: nothing.
   - `pull up`: `(Vhigh, pullOhms)`, `pull down`: `(0, pullOhms)`; default `pullOhms` 45000 for MCU internal pulls, or the pin's `pullup_ohms`/`pulldown_ohms` (its pull-up goes to its `pull_rail` voltage).
   - `analog`: `(mv, ohms)`.
   - rails: `V33` is `(3300, 1)` only while the device has switched it on; `V5` is `(5000, 1)` while on; `ground` terminals are `(0, 0.01)`.
   - a `pwm` terminal is an `out` whose level follows the phase `((t * hz) mod 1e6) / 1e6 < duty`, so a digital read of a PWM net is deterministic in virtual time. The net keeps `pwm = {hz, dutyQ16, mvHigh}` as a property (5.6).
2. **Voltage** `V = sum(mv_i / ohms_i) / sum(1 / ohms_i)`. No sources: the net is **floating**: reads 0, `flags.floating` set (the UI shows a dashed wire; bench-spec's default "floating pins read low" holds).
3. **Digital level** seen by a reader with supply `Vdd` (its own net voltage; the device reads with 3300): `V >= 0.75*Vdd` is 1, `V <= 0.25*Vdd` is 0, in between **keeps the previous level** (hysteresis; initial 0). The same level is what `edge` events report.
4. **Order**: solve nets that contain a `power_out` or `ground` first (they are stiff), derive each part's `Vhigh` and power state (5.7), then solve the rest. Sources that depend on other nets (`divider`, `servo`, `h_bridge` reading inputs) are re-evaluated in at most 4 passes until nothing changes.

This single model replaces ad-hoc cases: a button to ground with the app's input floating reads 0 (no pull: bench-spec Q4), with a pull-up part reads 1 until pressed, an I2C bus is "two nets with pull-ups", a potentiometer on EXP8 reads its divider voltage, 5 V into a 3.3 V pin raises a hazard (5.4).

### 5.4 Conflicts and hazards

After solving a net the router classifies it. **Strong** sources are those with `ohms <= 1000`.

| Condition | Class | Result | UI |
|---|---|---|---|
| two strong sources whose voltages differ by more than 1000 mV (output high against output low; `V5` against `V33`; output against a rail) | **short** (error) | net voltage is the formula's value, level holds its previous value | red wire and both ends, tooltip names both terminals, voltages and the part owners: "EXP4 drives high (3.3 V) while p2.IN drives low" |
| two push-pull outputs on one net agreeing in level | **contention** (warning) | normal | amber wire: "two outputs on one net" |
| two `pwm` terminals with different `(hz, duty)` | short | as above | red |
| net voltage above any terminal's `abs_max_mv` (default 3600) | **over-voltage** (warning) | normal | amber part badge: "5 V on a 3.3 V pin: p1.SDA" |
| part `power_in` above `max_mv` | over-voltage on the supply | part stays off while it lasts | red badge "supply too high" |
| sum of `typ_ma` of parts on `V5` above 500 mA, or on `V33` above an assumed 300 mA | budget (warning) | normal | amber on the header |
| wire loop between two terminals of the same net | ignored | | |

Nothing is ever blocked and no part is "burned" (owner question Q5, default warn only). Every class is delivered to the UI as `{net, class, terms[], text}` so the wiring view and the part badges share one list.

### 5.5 Buses, at transaction level

Bus traffic is **never** simulated as edges. A master announces what it is, and when it starts a transaction the router resolves it to the parts on those nets and returns the answer.

**Announcements** (`busOpen`): `{id, kind: 'i2c'|'spi'|'uart', role, terms..., params}`:

| Kind | Master (device or MCU part) | Slave (MCU part or declarative part) |
|---|---|---|
| I2C | `sda, scl, hz` | `sda, scl, address(es)`, optional `hzMax` (default 400000) |
| SPI | `sck, miso, mosi, cs, hz, mode` | `sck, miso, mosi, cs (or null = always selected), modes[], hzMax` |
| UART | `tx, rx, baud` | `tx, rx, baud` (peers are symmetric) |

For wasm parts the announcement comes from the sketch (`Wire.begin(addr, sda, scl)` calls `i2c_slave_begin` with **GPIO numbers**; the router maps them through `pins[].gpio`); for declarative parts it comes from the element at power-on.

**I2C, device or part as master**
1. The master issues `xfer({kind:'i2c', addr, w, rlen, stop})`. A zero-length write is a probe.
2. Pre-check: master SDA net and SCL net must not be held low by anyone before the start (level 0 with no master activity) or the result is `stuck` (the device gets `KODE_TIMEOUT` from a probe, `KODE_IO_ERROR` from a transfer, as `kdrv_exp_bus.h` documents). Missing pull-ups on either net: `stuck` too (the device's own internal pull-ups count).
3. Candidate slaves: every powered part with an I2C slave role whose `sda` terminal is in the master's SDA net **and** whose `scl` is in the master's SCL net and whose address matches. If none matches but a slave exists with SDA and SCL **crossed**, the result is `nack` and the diagnostic "SDA and SCL look swapped on p1" is attached.
4. Deliver `i2cSlave({addr, w, rlen, hz})` to each candidate (wasm: through the mailbox, 5.9, answered inside `onReceive` then `onRequest`; declarative: the register file). A candidate that does not answer within 100 ms (`KODE_I2C_TIMEOUT_MS`) counts as `timeout`.
5. Combine: ACK if any candidate acked; write data goes to all candidates; read data is the **bitwise AND** of the candidates' replies (open-drain: 0 wins), shorter replies padded with 0xFF. **Two candidates with one address is an address collision** (warning on both parts, the AND result is returned).
6. Results to the master: `ok`, `nack_addr`, `nack_data`, `stuck`, `timeout`; the device driver maps them to `KODE_OK` / `KODE_IO_ERROR` / `KODE_TIMEOUT` / `KODE_ERROR`, Arduino masters to `endTransmission` codes 0, 2, 3, 4.
7. Clock above the slave's `hzMax`: still answers, a warning is shown ("p1 supports up to 100 kHz, bus runs at 400 kHz").

A part acting as I2C **master** (an ESP32 reading a sensor part) uses the same path; it can address declarative parts and MCU slaves, never the device (the device has no slave role, which kode.h confirms). Several masters are serialised in arrival order; arbitration is not modelled.

**SPI, device or part as master**
1. `xfer({kind:'spi', w})` (device: at most 64 bytes, `KODE_SPI_XFER_MAX`).
2. Selected slaves: powered parts with an SPI slave role whose `sck`, `mosi` and `miso` terminals are in the master's nets, and whose `cs` terminal is in the master's CS net (or that have no `cs`).
3. Mode or clock mismatch (`mode` not in the slave's `modes`, `hz > hzMax`): the slave still runs but **MISO returns 0x00**, with a warning that names both values: "p1 needs mode 0, bus is mode 3". This is deliberate: it teaches the datasheet.
4. Deliver `spiSlave({mode, hz, w})`; the reply bytes are the master's `in`. Several selected slaves: AND of the replies plus a contention warning. **No slave selected**: `in` is `0xFF` if the MISO net has a pull-up, else `0x00` (the SDK says "whatever the data-in pin floated at").
5. CS: during the transfer the router drives the CS net low (event for anyone watching it), then releases it.

**UART**
1. Device `kode_uart_begin(tx, rx, baud)` announces tx/rx terminals; a part announces its own (`Serial1.begin(baud, SERIAL_8N1, rxPin, txPin)`).
2. Link: A's tx net equals B's rx net (and optionally the reverse). Only wires matter; a straight (TX to TX) wiring links nothing and the UI says so.
3. `uartTx(port, bytes, t)` delivers `uartRx(port, bytes, arriveAt[])`, `arriveAt[i] = t + (i + 1) * 10 / baud` seconds (8N1). The receiver sees a byte only when its clock reaches `arriveAt[i]`; `Serial1.available()` and `kode_uart_read(.., ms)` both count in virtual time.
4. Baud mismatch (more than 3 % apart): the bytes are **dropped** and both sides get a warning with both rates. Only 8N1 exists on the device; a part configuring another frame format on the same link gets the same treatment.
5. Receive overflow follows the receiver (device: 1024, Arduino: 256 by default in dotcore).

**GPIO**: no message, only the solver and `edge` events. `edge(term, level, t)` is sent to every watcher on the net when the digital level (5.3 step 3) changes; `t` is when the **cause** happened, not when it was delivered.

### 5.6 PWM and analog

- PWM is a **property of the net**: `{hz, dutyQ16, mvHigh}`, never a stream of edges. A reader asks the NetTable: `pwmHz[net]`, `pwmDuty[net]`. A part with a `pwm`-aware element (`servo`, `h_bridge`, an LED visual) reads it directly. An ADC read of a PWM net returns the **time average** `duty * mvHigh` (as if an RC filter were there; stated limit). A digital read returns the instantaneous phase level (deterministic in virtual time).
- A part (or sketch) with an edge `watch` on a PWM net gets no edges in v1.
- Analog is DC millivolts per net (`NetTable.mv[net]`). `analogRead` = `mv * (2^bits - 1) / 3300` clamped; the device's ADC uses 3100 mV full scale (5.2).

### 5.7 Power rails and part power

- The device endpoint starts with both rails **off** at app launch; `kode_pin_power_3v3(true)` and `kode_pin_power_5v(true)` call `setRail`. This matches the SDK ("state at boot is not promised") and forces apps to switch the rail, like on the real device. A setting "rails on at boot" is a convenience for quick tests, off by default.
- A part is **on** when every `power_in` pin's net is within `[min_mv, max_mv]` and at least one `ground` pin is on the `GND` net. Anything else is **off**: a declarative part's elements are inert, a wasm part's Worker does not exist.
- Off to on: the runtime creates the instance (wasm: new Worker, compile, `_initialize`, `dp_start`) and the part's pins take their `default` state. On to off: the Worker is terminated, its pins go to `z` with no pull, and its mailbox is discarded. Fields, `Preferences` data and position survive; `millis()` restarts at 0.
- Power glitches shorter than 1 ms of virtual time are ignored so wiring edits do not thrash instances.
- Boot costs measured in the spike (Node 22): 39 to 52 ms from spawn to `setup()` done.

### 5.8 Virtual time

One **bench clock** is shared by the device runtime, the router and every part. It lives in a 64-byte SharedArrayBuffer (layout in `spikes/arduino/host/layout.mjs`): `mode` (realtime or stepped), `virt_base`, `real_base`, `rate_ppm`, `paused`, `stepped_now`.

- **Realtime** (default): `now = virt_base + (real_now - real_base) * rate`. `real_now` is `performance.timeOrigin + performance.now()`, consistent across Workers. `rate` is the speed setting (1.0 default). Pause sets `paused` and re-bases.
- **Stepped** (tests, a "step" button): `now` is written by the harness. `delay()` in a part blocks until the harness moves time; the harness waits until every part is parked, then jumps to the earliest deadline. Measured: 6 virtual seconds of the Blink sketch ran in 35 to 96 ms of wall time with every interval exactly 1,000,000 us.
- `millis()`, `micros()`, `esp_timer_get_time()` of a part count from **its power-on**. Event timestamps in messages are bench-absolute.
- `delay(ms)` and `delayMicroseconds(us)` are one blocking import, `wait_until_us(deadline)`: the Worker sits in `Atomics.wait` with a timeout and wakes early for any request, clock or pause change (5.9). `yield()` and every other import also service pending requests. **Spin loops** on `millis()` work in realtime mode and in stepped mode only if the harness lets time run (a documented limit for tests).
- **Hidden tab.** Parts, router and device run in Workers and block with `Atomics.wait`, so they are not throttled by the browser's background-timer rules (those hit the main thread: rendering stops, `setInterval` drops to 1 Hz). Therefore: (1) nothing on the critical path may depend on a main-thread timer or `requestAnimationFrame`; (2) default policy keeps time running while hidden on desktop and **pauses the clock on hidden on touch devices** (iOS suspends background pages entirely and a resume would jump time by minutes); a setting overrides it. When paused, the next import of every part blocks until resume, so a spin loop on `millis()` does not burn CPU.
- A part stuck in a loop that calls no import never yields: its heartbeat counter (`mb[HEARTBEAT]`) stops advancing; after 2 s the UI badges it "busy loop", after 5 s it offers (or, by setting, does) restart. Spike: `test_busy.mjs`, `terminate()` returned in 3 to 11 ms.

### 5.9 Transport and the wasm ABI 1

#### 5.9.1 Why this transport

A sketch calls `delay()` and `Wire.requestFrom()` and expects them to block. The device's own threads can block, so can a part's Worker. The router must **not** block (it serves everyone), so: blocking happens only at the endpoints, on `Atomics.wait`; the router is event-driven.

| Direction | Mechanism | Used for |
|---|---|---|
| clock, net values, part power | read-only SharedArrayBuffers, plain atomic loads | `now`, `pin_read`, `adc_mv`, PWM property |
| part to router | **outbound ring** (SPSC, 32-byte records, in a SAB) plus a **doorbell**: `MessagePort.postMessage(0)` sent only when the ring was empty before the push | pin/PWM/rail drives, serial text, bus announcements, outputs, logs, master transactions |
| router to part | **inbound ring** plus `Atomics.add/notify` on the wake word | I2C/SPI slave requests, UART bytes, edges, field changes, wireless requests |
| part waits for the reply of its own master transaction | `Atomics.wait` on a reply word in its mailbox | `i2c_xfer`, `spi_xfer` |
| UI to router | ordinary `postMessage` | wiring edits, field edits, pause, step |

Re-entrancy is the key property: a request is served **from inside the part's blocking import** (the wake-up loop in `waitUntil`), by calling an export of the same module (`dp_i2c_slave_event`) while the sketch is parked in `delay()`. That is how `onReceive`/`onRequest` run, how interrupts run, and why a callback may itself call `delay()` (nested wait = clock stretching). A request is claimed with compare-and-swap (posted 1, serving 3, done 2) before dispatch; the spike found that without it an import called from the callback (`dotbenchField`) re-dispatches the same request and recurses until the stack overflows.

Measured in the spike (Node 22): bench to part to bench I2C write_read round trip **42 to 57 microseconds**; wake-up overshoot of `delay(1000)` in realtime **0.15 to 0.5 ms per second**.

#### 5.9.2 Shared memory layout

Spike layout (implemented): clock block (`CLOCK` indices, BigInt64) and a per-part **mailbox** (Int32 control words: `WAKE`, `STATE` (parked flag), `DL_LO/HI` (deadline), `REQ` (request slot state), `KIND`, `ADDR`, `WLEN`, `RLEN`, `RES`, `RDONE`, `HEARTBEAT`, `PIN_IN[64]`; 256-byte write and read buffers; 32 float64 field values), and an **outbound ring** of 2048 records of 8 x int32: `kind, a, b, c, ts_lo, ts_hi, d, e` (kinds: `PIN_MODE, PIN_WRITE, UART, PWM, I2C_SLAVE, I2C_MASTER, UART_BEGIN, PIN_IRQ, OUTPUT`). A full ring drops the record and counts it (`ring[2]`).

v1 changes: (1) the single `REQ` slot becomes an **inbound ring** of 32-byte records with a payload arena, so UART bytes, edges and several requests queue; (2) `PIN_IN` is replaced by `termNet[]` plus the router's **NetTable** (`level[net]` Int8, `mv[net]` Int32, `flags[net]`, `pwmHz[net]`, `pwmDuty[net]`, `partPower[part]`), single writer (router), plain atomic loads for readers; (3) master transactions use a request id and a reply word; (4) field bytes area (32 x 256 B) next to the float64 values. Rate limit: a part pushing more than 20,000 events per second is throttled and flagged.

#### 5.9.3 Imports (module `dotbench`) and exports

`pin` is the firmware's Arduino pin number (the manifest's `pins[].gpio`); a pin with no terminal is allowed and only affects visuals bound to `{gpio}`. "Spike" marks what exists in `spikes/arduino/core/dotbench_abi.h`.

| Import | Signature | Meaning | Spike |
|---|---|---|---|
| `time_us` | `() -> u64` | bench clock, microseconds | yes |
| `wait_until_us` | `(u64 deadline)` | block until the clock reaches it, serving requests | yes |
| `yield` | `()` | serve pending requests | yes |
| `pin_mode` | `(i32 pin, i32 mode)` | 0 INPUT, 1 OUTPUT, 2 INPUT_PULLUP, 3 INPUT_PULLDOWN, 4 OUTPUT_OPENDRAIN | yes |
| `pin_write` | `(i32 pin, i32 level)` | `drive(out/od)`; unchanged level sends nothing | yes |
| `pin_read` | `(i32 pin) -> i32` | digital level from the NetTable | yes (host-fed) |
| `pin_irq` | `(i32 pin, i32 kind)` | 0 none, 2 CHANGE, 3 FALLING, 4 RISING; edges arrive through export `dp_pin_event` | plumbing only |
| `pwm` | `(i32 pin, u32 hz, u32 duty_q16)` | PWM property; `hz = 0` stops | yes |
| `adc_mv` | `(i32 pin) -> i32` | millivolts on the net | yes (host-fed) |
| `dac_mv` | `(i32 pin, i32 mv)` | analog source on the pin (`dacWrite`) | designed |
| `uart_begin` | `(i32 port, u32 baud, i32 rx, i32 tx)` | port 0 is the console (shown in the part's pane, never on pins); ports 1 and 2 use the pins | yes |
| `uart_write` | `(i32 port, ptr, len)` | bytes out | yes |
| `i2c_master_begin` | `(i32 port, i32 sda, i32 scl, u32 hz)` | announce master | yes |
| `i2c_xfer` | `(i32 port, i32 addr, ptr w, len wn, ptr r, len rn, i32 stop) -> i32` | blocks for the reply; returns Arduino codes 0, 2, 3, 4 | stub NACK |
| `i2c_slave_begin` | `(i32 port, i32 addr, i32 sda, i32 scl)` | announce slave | yes |
| `spi_begin` | `(i32 port, i32 sck, i32 miso, i32 mosi, i32 cs, u32 hz, i32 mode)` | master (slave role in v1.1) | designed |
| `spi_xfer` | `(i32 port, ptr w, ptr r, len n) -> i32` | full duplex, blocks | designed |
| `field_f64` | `(i32 idx) -> f64` | current value of a number/integer/boolean/enum field | yes |
| `field_bytes` | `(i32 idx, ptr out, len cap) -> i32` | string/bytes/color field | designed |
| `output_f64` | `(i32 idx, f64 v)` | publish an `outputs[]` value | yes |
| `nvs_get`, `nvs_set` | `(key ptr/len, value ptr/len)` | `Preferences` | designed |
| `log` | `(i32 level, ptr, len)` | part console | designed (spike uses `uart_write(0)`) |

| Export | Meaning | Spike |
|---|---|---|
| `_initialize()` | run C++ static constructors (a standalone module has no `main`) | yes |
| `dp_start()` | `setup()` then `loop()` forever | yes |
| `dp_scratch() -> ptr` | 512-byte exchange buffer for requests | yes |
| `dp_i2c_slave_event(port, addr, wn, rn) -> n` | one slave transaction: write part in scratch[0..wn), reply in scratch[256..) ; -1 = not mine (NACK) | yes |
| `dp_pin_event(pin, level)` | run the interrupt handler | yes |
| `dp_uart_rx(port, byte)` | push one received byte | yes |
| `dp_spi_slave_event`, `dp_wireless_request` | | designed |

The loader accepts only modules whose imports are a subset of this table and whose exports are a subset of this list plus `memory` and `__indirect_function_table` (section 8). Additions are new ABI versions (`behaviour.abi`).

### 5.10 What this model cannot represent

State this in the manual (section 10) so nobody debugs the wrong thing:

1. **Edge-level protocols**: bit-banged I2C/SPI/UART from GPIO, 1-Wire, DHT22, WS2812/NeoPixel timing, IR carrier timing, `pulseIn()` on a real pulse train. The device cannot generate them anyway (its `kode_pin_write` is a blocking, posted command, not a register poke); parts could, and the router would not understand them. Escape hatch for v2: **frame protocols**, an op `frame(pin, protocol, bytes)` plus receivers that declare `protocols: ["ws2812"]`, so a NeoPixel strip or a DHT part is one transaction, like I2C.
2. **PWM edges**: only `(hz, duty)`. A counter or decoder watching a PWM net sees nothing.
3. **Waveforms and analog dynamics**: signals are DC; no RC, ringing, noise, ADC sampling of an AC signal, capacitor charge.
4. **I2C**: clock stretching is ignored except as the 100 ms timeout, no arbitration, no 10-bit addresses, no SMBus timeouts, no general call, no bus capacitance. Pull-up value affects only "is there a pull-up".
5. **SPI** timing (setup, hold), clock polarity mismatch beyond the declared-mode check, multi-slave MISO fights beyond AND.
6. **Current and damage**: no current model, no "smoke". Only the 5 V budget, over-voltage and short warnings.
7. **Interrupt latency**: edges and slave requests reach a sketch at its next import call (a tight loop with no import never sees them), and with 0.15 to 0.5 ms of wake jitter; `noInterrupts()` masking is not implemented in the spike.
8. **UART** other than 8N1; framing/parity errors beyond baud mismatch; flow control.
9. **Exact timing**: virtual time is exact only in stepped mode; realtime has sub-millisecond jitter.
10. **Wired coupling not through terminals**: nothing travels through the air or the ground plane except declared wireless ports.

---

## 6. Built-in modules and bench objects in the same format

The official modules (stage 5) and the wireless bench objects are `.dotpart` files shipped inside the site (ids `dotbench.*`), loaded by the same loader. They prove the format against real parts.

### 6.1 Robotics module (sketch)

Pin names follow a common dual H-bridge (DRV8833 class: `IN1..IN4`, `nSLEEP`, `nFAULT`, supply `VM`). **The AT8833CQ datasheet and the Robotics module schematic are not in the SDK; verify this table against them before shipping.** The positions of the module on J3 are likewise assumed.

```json
{
  "schemaVersion": 1, "id": "dotbench.module-robotics", "version": "1.0.0",
  "name": { "en": "Robotics module", "pt-BR": "Módulo Robótica", "es": "Módulo Robótica" },
  "author": { "name": "dotbench" }, "license": "GPL-3.0-or-later", "category": "module",
  "description": { "en": "Two DC motor outputs, one hobby servo header and an I2C port, driven from the expansion header." },
  "picture": { "file": "robotics.svg", "width": 480, "height": 300 },
  "pins": [
    { "name": "V5",  "kind": "power_in", "min_mv": 4500, "max_mv": 5500, "typ_ma": 60, "pos": {"x": 20, "y": 20} },
    { "name": "GND", "kind": "ground", "pos": {"x": 20, "y": 60} },
    { "name": "IN1", "kind": "io", "pos": {"x": 60,  "y": 20} },   { "name": "IN2", "kind": "io", "pos": {"x": 100, "y": 20} },
    { "name": "IN3", "kind": "io", "pos": {"x": 140, "y": 20} },   { "name": "IN4", "kind": "io", "pos": {"x": 180, "y": 20} },
    { "name": "SLEEP", "kind": "io", "pos": {"x": 220, "y": 20}, "pullup_ohms": 100000, "pull_rail": "V5" },
    { "name": "SERVO", "kind": "io", "pos": {"x": 260, "y": 20} },
    { "name": "SDA", "kind": "io", "pos": {"x": 300, "y": 20} },  { "name": "SCL", "kind": "io", "pos": {"x": 340, "y": 20} },
    { "name": "P_SDA", "kind": "io", "pos": {"x": 400, "y": 280} }, { "name": "P_SCL", "kind": "io", "pos": {"x": 440, "y": 280} }
  ],
  "outputs": [
    { "name": "m1", "type": "number", "min": -1, "max": 1 }, { "name": "m2", "type": "number", "min": -1, "max": 1 },
    { "name": "servo_angle", "type": "number", "unit": "deg", "min": 0, "max": 180 }
  ],
  "visuals": [
    { "id": "m1_wheel", "effect": "rotate", "x": 120, "y": 200, "r": 40, "source": { "output": "m1" } },
    { "id": "m2_wheel", "effect": "rotate", "x": 240, "y": 200, "r": 40, "source": { "output": "m2" } },
    { "id": "arm", "effect": "rotate", "x": 380, "y": 200, "r": 40, "source": { "output": "servo_angle" } }
  ],
  "behaviour": { "type": "declarative", "engine": 1, "elements": [
    { "type": "h_bridge", "in1": "IN1", "in2": "IN2", "enable": "SLEEP", "output": "m1" },
    { "type": "h_bridge", "in1": "IN3", "in2": "IN4", "enable": "SLEEP", "output": "m2" },
    { "type": "servo", "pin": "SERVO", "output": "servo_angle", "min_us": 1000, "max_us": 2000, "range_deg": 180 },
    { "type": "bridge", "a": "SDA", "b": "P_SDA" }, { "type": "bridge", "a": "SCL", "b": "P_SCL" }
  ] }
}
```

What this proves: power gating (the module is dark until the app calls `kode_pin_power_5v(true)`), PWM as a property (`kode_pin_write_pwm(IN1, 1000, 60)` becomes `m1 = 0.6`), two parts sharing an I2C bus through `bridge` (a sensor part plugged into `P_SDA/P_SCL` shows up on the device's bus), and outputs driving the picture. A servo on `SERVO` needs 50 Hz: `kode_pin_write_pwm(SERVO, 50, 7)` gives a 1.4 ms pulse, angle 72 degrees.

### 6.2 NFC tag (wireless)

```json
{
  "schemaVersion": 1, "id": "dotbench.nfc-tag", "version": "1.0.0",
  "name": { "en": "NFC tag", "pt-BR": "Tag NFC", "es": "Etiqueta NFC" },
  "author": { "name": "dotbench" }, "license": "GPL-3.0-or-later", "category": "wireless",
  "description": { "en": "A passive NFC type 2 tag with an NDEF text or URL record." },
  "picture": { "file": "tag.svg", "width": 200, "height": 120 },
  "pins": [ { "name": "NC", "kind": "nc", "pos": {"x": 10, "y": 10} } ],
  "wireless": [ { "name": "nfc", "medium": "nfc_a", "role": "target", "range_mm": 40,
                  "pos": {"x": 100, "y": 60}, "config": { "tech": "type2" } } ],
  "fields": [
    { "name": "uid", "type": "bytes", "label": { "en": "UID" }, "default": "04a1b2c3d4e580", "max_bytes": 7 },
    { "name": "kind", "type": "enum", "label": { "en": "Record" }, "default": "text",
      "values": [ { "value": "text", "label": { "en": "Text" } }, { "value": "url", "label": { "en": "Link" } } ] },
    { "name": "payload", "type": "string", "label": { "en": "Content" }, "default": "hello", "maxLength": 128 }
  ],
  "behaviour": { "type": "declarative", "engine": 1, "elements": [
    { "type": "wireless", "port": "nfc", "config": {
        "uid": { "field": "uid" }, "ndef": { "kind": { "field": "kind" }, "value": { "field": "payload" } } } } ] }
}
```

It has no pins that matter and no power: a wireless **target** is passive (an active role such as a reader or a BLE peripheral can list a `power_in` pin and then needs wiring like any part). The router links it to the device's NFC reader when it is within `range_mm`; the medium's request/response payloads (`wirelessRequest`) and the exact `config` schema belong to stage 2. The same shape covers `rfid_125k` tags (EM4100 id field), `ble` peripherals (a sensor with fields and a GATT table in `config`) and Wi-Fi access points.

---

## 7. Build path: `dotbench part build`

### 7.1 Project folder (what the user edits)

```
my-part/
  manifest.json            validated against manifest.schema.json
  picture.svg|png|webp
  src/main.ino             main sketch (the only .ino, or main.ino); more .ino/.cpp/.h next to it
  libraries/<Lib>/src/...  Arduino libraries (library.properties optional), copied in by hand
  tests/*.test.json        scenarios for `part test`
```

### 7.2 Commands (the same `dotbench` tool that builds apps, run on the Mac)

| Command | Does |
|---|---|
| `dotbench part new <folder>` | copies the starter folder |
| `dotbench part check <folder>` | schema + semantic lint of the manifest, picture bounds, pin/field/output cross references, translations present (`pt-BR`, `es` warn only) |
| `dotbench part build <folder> [-o out.dotpart]` | compile (wasm parts) and pack; output `<id>-<version>.dotpart` |
| `dotbench part test <folder>` | build, then run `tests/*.test.json` headless in Node (the spike's `run_scenario.mjs` is the prototype: `advance_ms`, `set_field`, `i2c`, `expect_serial`, `expect_output`) |
| `dotbench part inspect <file.dotpart>` | print what the import dialog would show (section 8.3) |

Declarative parts need no compiler: `build` only validates and zips.

### 7.3 Steps of `part build` for a wasm part

1. Validate `manifest.json`.
2. Generate `dotbench_fields.h` from the manifest: `enum { FIELD_<NAME> = i, ... }` for number/integer/boolean/enum fields in manifest order, `enum { OUTPUT_<NAME> = i }` for outputs (spike: `genfields.mjs`). Bytes/string/color fields get their own index space for `dotbenchFieldBytes` (v1).
3. `.ino` to C++: concatenate (main first, then the others by name), prepend `#include <Arduino.h>`, insert forward prototypes of top-level functions, emit `#line` so errors point at the user's file. This is what the IDE does with ctags. The spike's `ino2cpp.mjs` is a comment/string-masking brace-depth scanner; verified on a sketch calling a later-defined function (without it: `use of undeclared identifier`). Known weak spots: default arguments, function-pointer-returning functions, definitions generated by macros or inside `#if`. The CLI keeps the scanner and, if the compile still fails with `undeclared identifier`, prints the exact line and the one-line fix ("add a prototype").
4. Compile with the **pinned toolchain** (Emscripten 7.0.0, same as the device build):
   ```
   em++ -Os -std=gnu++17 -fno-exceptions -fno-rtti -ffunction-sections -fdata-sections \
        -I <dotcore> -I <ArduinoCore-API> -I <generated> -I src -I libraries/*/src \
        -DARDUINO=10819 -DARDUINO_ARCH_ESP32 -DESP32 -DHOST -Wno-main  -c <sketch>.cpp ...
   ```
   The core (`libdotcore.a` = `dotcore.cpp` + ArduinoCore-API's `Print Stream String IPAddress Common`) is **prebuilt and shipped with the CLI**: spike build time is 0.75 s per sketch with the cached core, 1.8 s with a cold core. Exceptions and RTTI are off, as on arduino-esp32's default.
5. Link:
   ```
   em++ -Os sketch.o libs.o libdotcore.a -o behaviour.wasm \
        -sSTANDALONE_WASM=1 --no-entry -sALLOW_MEMORY_GROWTH=0 \
        -sINITIAL_MEMORY=<memory_kb*1024> -sSTACK_SIZE=<stack_kb*1024> \
        -sERROR_ON_UNDEFINED_SYMBOLS=1 -Wl,--gc-sections -Wl,--export=dp_start
   ```
   No `-pthread`, no `-sPROXY_TO_PTHREAD`, no `-sASYNCIFY`: a part is one single-threaded module; its Worker is its thread. No JS glue, no WASI imports (spike: the imports are exactly the `dotbench.*` list). Sketches that use `xTaskCreate` or `std::thread` fail to link with a message pointing to section 2.3.
6. Post-link checks: size at most 2 MB, imports and exports within ABI 1, declared memory within `memory_kb`, SHA-256 recorded in `behaviour.wasm_sha256`.
7. Pack: copy `manifest.json` with the `build` block filled (toolchain, dotcore version, API commit, sources hash), picture, `behaviour.wasm`, and `src/` (sources and `libraries/`), into the `.dotpart`. The user's own `manifest.json` is not rewritten.

Spike sizes (all `-Os`): Blink 2146 B, the starter's LM75 sketch 11515 B, I2C slave 11645 B, `Serial.printf`, `Print` and `Wire` bring a sketch to about 11 KB.

### 7.4 Blocking calls: Atomics.wait Worker versus Asyncify (decision and measurements)

**Decision: each wasm part runs in its own Worker and blocks it in `Atomics.wait`. No Asyncify.** `delay()` is a blocking import; a `while(1)` loop simply never returns, which is what the sketch asked for.

Both were built from the same objects and measured in the spike (`asyncify/build_asyncify.sh`, `asyncify/probe.mjs`, results in `spikes/arduino/RESULTS.txt`; binaryen `wasm-opt --asyncify` on the same link):

| | Atomics.wait Worker (chosen) | Asyncify |
|---|---|---|
| `.wasm` size, Blink / I2C slave / perf probe | 2146 / 11645 / 11456 B | 3998 / 17312 / 16867 B (+47 % to +86 %) |
| 20 M-iteration compute loop | 48 to 58 ms | 54 to 60 ms (no real difference: the loop holds no async call) |
| 3000 `Serial.print` calls | 3.5 to 12 ms (dominated by BigInt timestamping in the spike's JS, not the design) | 0.7 to 1.2 ms |
| Serve a slave transaction while the sketch sleeps in `delay()` | yes (re-entrant export call from inside the wait) | yes, only if the callback never sleeps (probe returned `[33,50,67,84]`) |
| A callback that calls `delay()` (clock-stretching style) | works (nested wait) | impossible: Asyncify cannot nest sleeps |
| `Wire.requestFrom`, `Serial.readBytes` (blocking master calls) | plain blocking import | every function on the path to the import is instrumented, more size and speed cost |
| Busy loop with no import | kill the Worker: `terminate()` 3 to 11 ms (spike `test_busy.mjs`) | cannot interrupt either |
| Needs | one Worker per MCU part, SharedArrayBuffer (COOP/COEP, which the device already requires) | nothing special |

Why: smaller modules, correct semantics for nested waits and for blocking master calls (which the router answers asynchronously while the part sleeps), no binaryen step in the CLI, and the stack stays intact for debugging. The price is **one Worker per running MCU part**: spike measure in Node 22, 8 parked parts add 78 to 89 MB RSS (one V8 isolate each). Therefore **soft cap 8, hard cap 16 running wasm parts** (Q3); declarative parts cost none (they run in the router's Worker). The Asyncify build stays as a documented fallback if a target without SharedArrayBuffer ever matters.

### 7.5 Memory

`behaviour.memory_kb` (default 1024, 256 to 8192) becomes the fixed linear memory (`INITIAL_MEMORY`, no growth), `stack_kb` (default 64) the shadow stack. A real ESP32 has about 320 KB of heap, so the default is generous and exists to stop runaways. `malloc` failure returns null, `new` aborts (no exceptions). A trap (`unreachable`, out-of-bounds, abort) stops the part and shows "crashed: <reason>" on it; like a real ESP32 panic it **reboots** (new instance) after 1 s, at most 3 times in a row, then stays stopped until the user restarts it.

### 7.6 Arduino libraries

Copy library folders into `libraries/` (Arduino layout: `LibName/src/*.h|cpp` or flat, with or without `library.properties`). `part build` adds `libraries/*/src` (or the root of a flat library) to the include path and compiles the `.c/.cpp` files of the libraries whose headers the sketch includes (transitively), like the IDE. No downloading: the CLI is offline and library licences are the author's responsibility; the build prints each library's licence and warns when a copyleft library meets a non-copyleft `license`. A library that includes `avr/*.h`, touches `PORTB`/`DDRx` registers, or whose `architectures` is not `*`/`esp32`, is rejected with that reason. Expected to work (they use only the API): Adafruit BusIO and sensor drivers built on it, ArduinoJson, PID, Servo/ESP32Servo (through `ledc`), Ticker. **Not proven in the spike** (no library was compiled; most need `SPI.h`, which dotcore does not have yet). Compiling libraries inside the page is a future improvement; the manual says so.

---

## 8. Security and isolation

Parts are code from other people.

### 8.1 Sandbox

| Layer | Rule |
|---|---|
| Wasm capability | the module gets only `dotbench.*` imports. It has no `fetch`, IndexedDB, `postMessage`, `importScripts`, DOM, clock or randomness except what we hand it |
| Import/export allow-list | before instantiating, `WebAssembly.Module.imports/exports` are checked: every import must be in the ABI 1 table (module `dotbench`), exports within the allowed list plus `memory`/`__indirect_function_table`; any `env`, `wasi_*`, memory, table, global or tag import rejects the package. The memory section is parsed (a few lines of code) to check initial and maximum pages against `memory_kb` and to refuse shared memory and multiple memories |
| Worker | one dedicated Worker per wasm part, created from the same-origin script `/component-worker.js` (not a blob) with `{type: 'module', name: 'part:<instance>'}`. No DOM, no storage access by design |
| Network | none. The worker script is served with `Content-Security-Policy: default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'` (a dedicated worker's CSP comes from its own response), plus the COOP/COEP/CORP headers the page already needs. Wireless "internet" is the bench's router object, never a real socket. **Not tested in a browser in this spike; Engineer B verifies in Chrome, Firefox and Safari.** |
| Router validation | every value from a part is range-checked: pin numbers, lengths at most 256 bytes per record, rates (20,000 events per second per part, then throttle and flag), `hz` ranges, output indices |
| Watchdog | heartbeat per import; busy loop badge at 2 s, restart offer at 5 s (5.8); crash loop stops after 3 reboots (7.5) |
| Cross-part | no shared memory between parts; only the router sees both sides |
| Persistent data | only `Preferences` (4 KB per instance) and fields; nothing else is writable |

### 8.2 Package limits

At most 64 entries, 8 MB uncompressed in total, 100:1 inflate ratio, manifest 128 KB, wasm 2 MB, picture 1 MB, model 4 MB, 64 pins, 32 fields, 32 outputs, 64 visuals, 64 declarative elements. Strings are length-capped by the schema and shown as text, never as HTML. **Pictures**: PNG and WebP are decoded in a Worker with a time limit; SVG is shown only through `<img src=blob:>` (never inline, so no script runs) and is rejected if it contains `<script`, `foreignObject`, `on*=` attributes, external `href`s, or entity declarations. **glTF**: parsed with a size-limited loader, no external buffer or image URIs. Reserved ids: `dotbench.*` cannot be imported or override a built-in. An id already installed with another SHA-256 is an update prompt, never silent.

### 8.3 What the import dialog shows before anything runs

Nothing is instantiated, compiled or decoded beyond the manifest and a thumbnail until the user clicks.

1. Name (all languages found), id, version, author and URL, SPDX licence, file size, SHA-256, picture.
2. **What it runs**: "Runs program code (Arduino/C++ compiled to WebAssembly, 11.5 KB)" or "Declarative, no code". For code: memory it will ask for, and whether sources are included ("View source": shows `src/`; marked **not verified: the sources may not match the program**, with both hashes).
3. **What it can touch**: its pins (names, kinds, supply range), the buses a code part *may* use (I2C, SPI, UART, PWM, ADC, GPIO: "decided while it runs, like a real ESP32"), wireless ports, number of editable fields.
4. **What it cannot do**, stated plainly: no network, no access to your files, other parts or the device except through wires you draw.
5. Warnings found by the validator: missing translations, picture/pos out of bounds, over-limit values, `id` already installed (update or replace), unsigned/unknown author (there is no signing in v1).
6. Buttons: Cancel, Import, Import and add to bench. A "don't ask again for this id" consent is stored per id and SHA-256; an update with a different hash asks again.

---

## 9. Storage, import/export, sharing

### 9.1 IndexedDB

Own database `dotbench-parts` (version 1), so it cannot collide with the app and file stores of other stages:

| Store | Key | Value |
|---|---|---|
| `parts` | `<id>@<version>` | `{id, version, sha256, bytes: ArrayBuffer, manifest, source: 'file'|'starter'|'builtin', importedAt, consent}` |
| `layouts` | layout name | the layout JSON (9.2) + `updatedAt` |
| `nvs` | `<layout>/<instance>` | `Preferences` bytes, at most 4 KB |

Built-in parts are not stored: they ship with the site and are registered at start. Quota: ask `navigator.storage.persist()`; soft cap 200 MB of parts, usage shown in the parts list. Parts are loaded into the Worker from a `Blob` of the stored bytes; nothing is fetched at run time.

### 9.2 Bench layout file (`.dotlayout`, JSON)

Lists the parts, their field values and the wiring. It never embeds code.

```json
{
  "format": "dotbench-layout", "version": 1, "name": "LM75 on EXP4/EXP5",
  "device": { "rails": { "V33": "app", "V5": "app" }, "header": "kode-dot-j3" },
  "parts": [
    { "instance": "p1", "part": { "id": "com.example.esp32-lm75", "version": "1.0.0", "sha256": "…" },
      "label": "Room sensor", "pos": { "x": 420, "y": 180, "rot": 0 }, "fields": { "temperature": 22.5, "address": 72 } }
  ],
  "wires": [
    { "id": "w1", "from": "device.EXP4", "to": "p1.SDA", "color": "#00aa00" },
    { "id": "w2", "from": "device.EXP5", "to": "p1.SCL" },
    { "id": "w3", "from": "device.V33",  "to": "p1.V33" },
    { "id": "w4", "from": "device.GND",  "to": "p1.GND" }
  ]
}
```

Terminals are `instance.pin`; the device is the instance `device` with `EXP1..EXP14`, `V33`, `V5`, `GND`. Loading validates every wire against the installed manifests (unknown pin: the wire is dropped with a message).

### 9.3 Import, export, sharing

- **Export part**: the stored `.dotpart` bytes as a download. **Export layout**: `.dotlayout`. **Export bundle**: `.dotbundle` (zip) with `layout.json` and `parts/*.dotpart` for every non-built-in part used, so a friend can open it with one click.
- **Import**: drag a `.dotpart`, `.dotlayout` or `.dotbundle` anywhere on the bench. A `.dotlayout` whose parts are missing lists them ("needs com.example.x 1.0.0, import its .dotpart") and keeps working with placeholders.
- **Share**: files only; there is no server and no gallery in v1. A layout that uses only built-in parts can also be copied as a link carrying the layout as URL-fragment base64 (no upload; at most 8 KB).
- Updating: importing a newer version keeps the old one until no saved layout needs it.

---

## 10. The "Make your own" tab

One tab, three ways in, all translated (`en`, `pt-BR`, `es`) through the site's translation layer; the starter folder carries README and PROMPT in the three languages.

### 10.1 Page outline

1. **What is a part?** Three kinds: no-code (declarative), programmable (an ESP32 with Arduino code), wireless object. A picture of a part wired to the header.
2. **Start here**: two buttons, "Download starter folder" (a zip built in the page from the bundled template) and "Copy the AI prompt".
3. **Manual** (table of contents below).
4. **Make it with AI** (10.3).
5. **Check my part**: drop a folder or `.dotpart`; shows manifest errors, the picture with every pin position drawn on it, and the import dialog preview (8.3). This is what Engineer C builds on the loader's validator.
6. **Share and import** (9.3).
7. **Troubleshooting**: the wrong-pin, no-power, floating-input, address-collision and swapped SDA/SCL messages the router produces, each with a screenshot and the fix.

### 10.2 Manual: table of contents

1. How a part is wired: terminals, nets, rails; why a part is dark until you switch its rail and wire GND.
2. What the Kode Dot can talk to: the table of section 1.2 in plain language (master only on I2C/SPI, one of each bus, 8N1 UART, PWM out, ADC on six pins, no pulse measurement).
3. Anatomy of a part folder and of `manifest.json`, field by field, with the picture coordinate system explained on an annotated image.
4. Your first part with no code: a button, then a potentiometer, then the LM75 (declarative elements one by one).
5. Your first programmable part: build the starter, run Blink, then the I2C sensor; how `Wire.begin((uint8_t)addr)` differs from `Wire.begin(sda, scl)`.
6. What your Arduino code can use: supported, stubbed and unsupported APIs (section 2.3), Serial console vs `Serial1`, pin numbers = manifest `gpio`.
7. Fields, outputs, controls and visuals: making the picture react.
8. Testing: `dotbench part test` scenarios, watching the part's console, stepping time.
9. Adding Arduino libraries.
10. Building, exporting, importing, sharing; licences (the `license` field, library licences).
11. Limits: everything in section 5.10, in plain words.
12. Copy-paste examples: button, potentiometer, LM75 (both kinds), blink, I2C slave, UART echo, PWM servo reader.

### 10.3 The AI path

1. The user downloads the starter folder (or runs `dotbench part new`) and opens it in an AI coding assistant (Claude Code or another).
2. They paste `PROMPT.md` (the "Copy the AI prompt" button copies the user's language version) as the first message, **ending with `Write what you want here:` and their own sentence**.
3. The prompt carries everything the assistant needs (schema, host interface summary, rules, commands, output contract), so it works with no other context and no internet.
4. The assistant edits `manifest.json`, `src/`, `picture.svg` and `tests/`, runs `dotbench part check` and `dotbench part test` until green, then `dotbench part build`.
5. The user drops the resulting `.dotpart` in the "Check my part" box, reads the import dialog and imports it.

Recommended model for Claude Code users, printed at the top of `PROMPT.md`: **Sonnet, effort medium** (Opus is not needed).

---

## 11. Staged build order and dependencies

Stage numbers 6.x extend the parent spec's "Etapa 6"; the router and header wiring are **also** what stage 5's "bench objects for the header" need, so 6.0 and 6.1 should be built together with stage 5, not after it.

| Step | Deliverable | Depends on (rest of dotbench) | Role |
|---|---|---|---|
| 6.0 | Terminals, nets, solver (5.3), conflicts (5.4), rails (5.7), NetTable, header terminal model with the J3 picture; wiring UI (add part, wire, delete, conflict display); declarative runner with `switch`, `bridge`, `divider`, `source`, `drive`, `pull`, visuals and controls; built-in LED, button, potentiometer; `.dotpart` loader/validator (declarative), IndexedDB store | stage 1 (clock block, console, IndexedDB helper), stage 5 fake `khal_gpio`/`khal_pwm`/ADC port and `setRail`; i18n layer | A + B |
| 6.1 | I2C/SPI/UART routing (5.5); web `kdrv_exp_bus`; `i2c_slave` element; UART/SPI echo parts; examples `exp_bus` and `expansion_io` pass against parts in Node tests | 6.0; runtime engineer's `kdrv_exp_bus` replacement | A + runtime |
| 6.2 | dotcore (spike core hardened: SPI master, Preferences, ESP32 compat), ABI 1, Worker host, inbound ring, `dotbench part new/check/build/test`, starter folder under CI, Blink and I2C-slave parts working against the device | 6.0, 6.1; `tools/` CLI scaffold and the pinned Emscripten; `vercel.json` headers incl. the worker CSP | B |
| 6.3 | "Make your own" tab, import dialog (8.3), export/import of parts, layouts, bundles, manual, AI prompt, "Check my part" | 6.0 loader; i18n; docs content | C |
| 6.4 | Official modules (Maker, Robotics) and wireless parts as built-in `.dotpart`s (6.1 and 6.2 examples) | stage 2 (NFC/RFID), 3 (BLE/Wi-Fi), 4 (IR) for each medium's `wireless` config and request payloads; module docs and schematics | B + stage owners |
| 6.5 | Extensions: SPI slave and `SPISlave`, Wi-Fi/BLE stubs made real through the router, frame protocols (NeoPixel, DHT), cooperative FreeRTOS tasks, compile-in-page | 6.2, stages 3 | later |

Verification built into each step: Node tests with the stepped clock (spike harness is the prototype), then Chrome headless for the page. Browser behaviour of `Atomics.wait` in Workers, the worker CSP, and iOS background suspension are **untested** and must be checked in 6.2.

---

## 12. Open questions for the owner (with recommended defaults)

1. **Which pins of J3 are ground, and in which physical order do the 14 positions sit?** The SDK names positions 1 to 14 and the docs quoted in `docs/bench-spec.md` say pins 1/20 are 5 V, 2/19 are 3.3 V and 3 to 9, 12 to 18 are GPIO; pins 10 and 11 are not stated. *Default:* P10 and P11 are GND, positions in order on P3..P9 and P12..P18; the layout lives in one data file and is trivial to fix.
2. **Pause the clock when the tab is hidden?** *Default:* off on desktop (the device keeps running like one on a desk), on on phones, with a setting.
3. **How many programmable (wasm) parts may run at once?** Each costs a Worker, about 10 MB in Node, less in a browser but not free. *Default:* soft cap 8 with a warning, hard cap 16.
4. **What do hazards do: only warn, or also "break" a part?** 5 V into a 3.3 V pin, a short, a supply too high. *Default:* warn only, never block, never latch damage (a Tinkercad-style "smoke" mode can be a later setting).
5. **Which ESP32 does the starter pretend to be?** *Default:* a generic ESP32 DevKit with arduino-esp32 pin numbers (GPIO 0 to 39, `LED_BUILTIN` 2, `SDA` 21, `SCL` 22); ESP32-S3 and C3 variants become separate built-in parts only if people ask.

---

## Appendix A. Spike result in one table

Full commands, numbers and what fought us: `spikes/arduino/README.md`; raw output of the last run: `spikes/arduino/RESULTS.txt`; reproduce with `spikes/arduino/run_all.sh` (about 15 s).

| Claim | Result |
|---|---|
| Unmodified Blink compiles against ArduinoCore-API + dotcore, runs in a Worker, edges timestamped in virtual time | 7 edges, every interval exactly 1,000,000 us in stepped mode (6 virtual s in 35 to 96 ms wall); realtime intervals 1,000,153 to 1,000,495 us |
| Unmodified ESP32-style I2C slave sketch answers a host-side `write_read` and prints to Serial | `[0x21,0x32,0x43,0x54]` for register 1; NACK at another address; writes stored; Serial lines match |
| The starter folder's own sketch and test scenario | builds (11.5 KB) and passes 9 steps, including a live field change |
| Sizes | Blink 2146 B, I2C slave 11645 B; module imports only `dotbench.*`, no WASI |
| Blocking strategy | Atomics.wait Worker chosen; Asyncify +47 to +86 % size, cannot nest sleeps (7.4) |
| Busy loop containment | heartbeat freezes, `terminate()` 3 to 11 ms |
| Not proven | browser run; the real router (nets, conflicts, several parts on one bus); GPIO input and edge interrupts end to end; SPI; I2C master to a bench part; third-party libraries; Preferences, Wi-Fi, BLE stubs; interrupt masking; worker CSP in browsers |
