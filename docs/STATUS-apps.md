# Starter apps (branch area/apps)

Each app is plain C against the public SDK, in the kode-app-template layout, with the shared kit in `apps/_kit` copied into `main/`.
Build: `DOTBENCH_BUILD=/tmp/apps-b tools/dotbench build apps/<name>`. Test: `node tests/node/apps/<name>/<name>.test.mjs`.
Screens of every page: `docs/apps-shots/<name>/`. Store shots: `apps/<name>/appdata/screenshots/`.

## Wave 1 (done, committed, tests pass)

| App | Checks | What works |
|---|---|---|
| light | 12 | Screen light, torch LED, SOS, colour and brightness, settings kept |
| nfc_kit | 13 | Read, save (16), list, emulate, delete; kept across restart |
| rfid_kit | 11 | Read, save, list, emulate, write to T5577, delete; kept |
| level | 8 | Bubble level with zero kept, tilt-compensated compass |
| files | 11 | /storage and /sdcard, preview, rename, delete, card pulled and put back |
| sound | 14 | Record to WAV (wire pitch and length checked), playback, stop, rename, delete, auto-save on leaving, tone generator with presets, volume, settings and numbering kept |

## Wave 2 (done, committed, tests pass)

| App | Checks | What works |
|---|---|---|
| ir_kit | 15 | Learn an NEC or raw button, save it by name into a named remote (6 remotes, 40 buttons, 128 symbols each), send on tap, hold repeats, rename, delete, kept across restart; tested on the Remote and TV bench objects |
| wifi_kit | 12 | Scan with lock, signal bars, channel; network page; join open/WPA2/hidden with a masked password keypad; wrong password, out of range, status with IP, disconnect, router and internet check by ping |
| gpio_kit | 9 | Pin map (1 to 14), output high/low, live input, PWM with frequency and duty steppers, analog, I2C scan, UART monitor; every one answers plainly when the fake lacks it |
| ble_kit | 8 | Nearby list with address and signal bars, device page, and the states busy, off, none and "not available"; on the real bench the app shows "Bluetooth is not available" |

Names to add to `tools/factory-apps.json` if the owner wants them preinstalled: `ir_kit`, `wifi_kit`, `gpio_kit`, `ble_kit` (display names "IR Remote", "Wi-Fi", "GPIO", "Bluetooth"). bad_usb: skipped, neither kode.h nor kode_sys.h exposes USB HID to apps.

Test notes: `DOTBENCH_BUILD=<fresh dir> node tests/node/apps/<name>/<name>.test.mjs`. `ble_kit`'s test also builds a throw-away copy of the sources in a temp folder with `kode_ble_scan()` replaced by canned answers (devices, nothing, busy, off) to reach the list, device and error screens; the list, device and listening shots (and the store shots) come from that copy, the unavailable shots from the real app. `lib.mjs` gained `typeText` (keypad typing with retry), `tapPage` (tap until the screen changes) and exposes the glue context.

## Fakes: what is missing

- exp (J3 pins and buses): `khal_exp_esp.c`/`kdrv_exp_bus.c` are stubbed. Digital pins work as bookkeeping only: `kode_pin_write` then `kode_pin_read` reads back the driven level, and an undriven input reads high; nothing outside can pull a pin (no bench object on J3). `kode_pin_write_pwm` is accepted but nothing is generated or measurable. Missing, each logged as "not implemented": `khal_exp_port_adc_open` (`kode_pin_read_analog` fails "pin N could not be read"), `kdrv_exp_i2c_open` (`kode_i2c_begin` fails, so no scan can find a device), `kdrv_exp_uart_open` (`kode_uart_begin` fails, no RX or TX). SPI was not used. `kode_pin_power_3v3/5v` not used by the app.
- BLE: no fake. `kode_ble_scan` answers "kode_ble_scan: this firmware has no Bluetooth" even with CONFIG_BT_ENABLED and CONFIG_KODEOS_BLE set in the app; the app classifies that as "not available".
- IR: capture reports no carrier (38 kHz assumed); hold-to-repeat resends the whole frame, not NEC repeat codes.
- Wi-Fi: the failed-join state event carries an empty ssid; `kode_sys` has no call to request NET_INFO, so the gateway is learned from the published NET_INFO_SIG or guessed as x.x.x.1.
- Audio: the app cannot read the microphone level, so the recorder shows time and a progress bar only, no meter.
- Display fake counts flushes, not frames; lib.mjs stands in for a 60 Hz counter so AO_Display does not take a still screen for a lost glass.

## Risks and notes

- Tests drive touch in real time. Under heavy machine load (load average above 15) a tap or slider drag is sometimes lost; reruns pass. Sound's volume check failed once under load and was widened.
- kode.h audio calls block, so Sound runs them on two workers (work and stop); keep that pattern.
- Shared-file changes needed: none. `tests/node/apps/lib.mjs` and `apps/_kit` are mine. Kit changes in Wave 2 (backward compatible, all apps re-synced and re-tested): `kit_name_t` takes up to 71 characters, a `secret` mode (stars, tap the field to show), a `hint`, a second symbols page, and an empty field starts in capitals again (so a test that clears a name then types must tap "abc" first, as files' does now).
- gpio_kit and ble_kit call blocking kode.h functions on a `kode_worker` (one job at a time); kode.h refuses calls from an Active Object. The I2C and UART pages are real code that has only been run against the fake's refusal.
- wifi_kit keeps the password in RAM only; it is never stored. The join has a 40 s fallback timer.
