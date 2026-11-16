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

## Wave 2 (not built)

ir_kit, wifi_kit, ble_kit, gpio_kit were not started: the session ran out of budget after Wave 1. area/ir and area/radio are ready to merge into this branch.
bad_usb: skipped. Neither kode.h nor kode_sys.h exposes USB HID to apps.
Notes for whoever does them: kode.h has `kode_ble_scan` (the radio area still answers "not supported", so show "Bluetooth is not available"), `kode_pin_*` for the expansion header (1..14), the IR and Wi-Fi calls need CONFIG_KODEOS_RADIO (merge area/radio first).

## Fakes: what is missing

- Audio: the app cannot read the microphone level, so the recorder shows time and a progress bar only, no meter.
- Display fake counts flushes, not frames; lib.mjs stands in for a 60 Hz counter so AO_Display does not take a still screen for a lost glass.

## Risks and notes

- Tests drive touch in real time. Under heavy machine load (load average above 15) a tap or slider drag is sometimes lost; reruns pass. Sound's volume check failed once under load and was widened.
- kode.h audio calls block, so Sound runs them on two workers (work and stop); keep that pattern.
- Shared-file changes needed: none. `tests/node/apps/lib.mjs` and `apps/_kit` are mine.
