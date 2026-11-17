# STATUS: integration 2 (boot + apps + radio + ir together), branch integ/verify

Main received four merges tested alone (area/boot, area/apps, area/radio, area/ir). This branch makes the combination true, runs everything, builds the factory set and hands the packages to the page. Branch base 94d4d97, plus integ/persist (test-only close-out) merged in.

## Passing output

Build dir seeded from /tmp/boot-build; both roles rebuilt (app: 305 SDK files, 185 stub functions; kodeos: 340 SDK files, 146 stub functions).

`tests/node/run.sh` (everything: acceptance, every area, then `tests/node/kodeos/run.sh` and `tests/node/boot/run.sh`): 959 `ok` lines in the full run. Per suite:

| Suite | ok |
|---|---|
| acceptance (buttons_led 5, display_lvgl 4) | 9 |
| apps: files 11, level 8, light 12, nfc_kit 13, rfid_kit 11, sound 14 | 69 |
| audio: example 19, files 47, layout 35, record 9, tone_volume 21 | 131 |
| haptic 16, motion 27, power 20 | 63 |
| ir: api_nec 27 (the `ir_api` tests RUN, no SKIPPED), example 17, fake 19, link 18, raw 25 | 106 |
| net: mqtt 39, mqtt_api 38, net 76, network_example 16 | 169 |
| nfc: cards 13, emulation 11, glue 7, missing 6, nfc_read 11, persist 1, tags 18 | 67 |
| radio 43, wifi 39 | 82 |
| rfid: ao_faults 25, em4100 38, emulate 35, example 10, read 24, write 41 | 173 |
| nvs 6, persist 6, sd 4, storage 17, system 6, time 4 | 43 |
| kodeos 13, kodeos radio 11 | 24 |
| boot: format 11, boot 11, factory 3 (check lines) | 25 |

Not green in that run, each judged on its own:
- `nfc/persist.test.mjs`: the second boot never reached "nfc_api ready" once; passed 5 of 5 reruns alone. FLAKE (not understood; the log showed only the first two boot lines, so the app thread stalled early; watch it).
- `system/restart.test.mjs` "20 restarts ... rss grew 234 -> 386 MB": PRE-EXISTING. Fails the same with the packages of the old finished build and with area/boot's own report; it is a Node memory measurement, not the combination.
- `boot.boot-test.mjs` "hold the bottom button ... 3000 ms": a wrong assertion, see below; fixed and green (11 ok).
Rerun alone after the fixes: radio 43, wifi 39, kodeos radio 11, boot 11, nfc persist 1: all pass.

Browser (`NODE_PATH=/home/claude/dotbench/web/node_modules tests/browser/run.sh`): adapter 13, persist 5, audio 8, boot 3 (the boot suite found one real bug, see 3 below, and passes after the fix).

## What the combination broke, and the fix

1. `kdrv_radio.c` did not compile (`ESP_CHIP_ID_ESP32C5` undeclared): both the apps area and the radio area shipped `esp_image_format.h` with the same include guard, the apps one won. One header now (apps area's, plus the chip-id enum); radio's copy removed; commit 0da8c3a. The build tool now fails loudly when two areas ship a header with the same relative path (`tools/dblib/areas.py`).
2. A still screen restarted the app after about 4 s (found by the Light app launched from kodeOS): `kdrv_display_link().frames` was the flush counter, AO_Display's health check takes a lit panel whose count stands still for a lost glass. The link now reports a free-running 60 Hz video-frame count. (apps/lib.mjs had a host-side stand-in for this; removed.) Without this no starter app that shows a still screen could survive in kodeOS.
3. `radio.js` decoded a view of shared memory (`TextDecoder` refuses it in Chrome): decodes a copy. Only Chrome sees it (Node does not check), it surfaced as page errors in the browser boot test.
4. `kodeos_boot/area.json`: the five radio `supersedes` removed (kdrv_ble.c stays stubbed); kodeOS runs the real radio stack over the radio fakes (`kodeos_radio.kodeos-test.mjs`: C5 link, board named from MAC, Wi-Fi scan/join through touch, SNTP, vault, router off/on). `bus_inform_slave_host_power_save_*` in `internal_stubs.c` now succeed instead of logging a failure (the radio area does not define them).
5. Runners: `tests/node/run.sh` with no area also discovers nested tests (`tests/node/apps/<app>/`) and ends with the kodeos and boot runners (`NODE_SKIP_OS=1` skips them); `tests/node/kodeos/run.sh` runs every `tests/node/*/*.kodeos-test.mjs`; `tests/browser/run.sh` runs the boot check when the packages exist; `tests/node/boot/run.sh` builds the whole factory set (`tools/build-factory.sh`).
6. Persist dirty counter (front-end report): it moved 354 times a second in kodeOS idle on this machine because `nfc_unlock()` marked the whole NFC region dirty at every unlock (the area's own comment said the host compares). It now compares against a shadow copy and marks only changed 4 KiB chunks: 354 -> 0 a second, measured with `dbpx_gen`. Also `dbp_write` / `dbp_fill` no longer mark writes that change nothing.

## Factory set (tools/factory-apps.json, order as listed by kodeOS)

| Package | Name in kodeOS | Category | Bytes |
|---|---|---|---|
| kody_kart | Kody Kart | games | 390619 |
| light | Light | tools | 594727 |
| nfc_kit | NFC | wireless | 629998 |
| rfid_kit | RFID | wireless | 609811 |
| level | Level | tools | 595617 |
| files | Files | tools | 597526 |
| sound | Sound | media | 646642 |
| display_lvgl | Display | example | 600271 |
| buttons_led | Buttons + LED | example | 322151 |
| kodeos (the OS) | | | 1424268 |

Build: `tools/build-factory.sh [dest]` (kodeOS + the nine). Copies are in `/home/claude/dotbench/build/apps/<name>/<name>.dotbench` (ten files). Every package carries name, app.json and `board/icon.k64` (buttons_led and display_lvgl have no icon: kodeOS draws the letter badge). Versions come from the app (`01.00.00` for the starter apps and Kody Kart, `0.0.0` for the SDK examples).

`tests/node/boot/factory.boot-test.mjs` (3 checks): fresh boot lists the nine with names, versions, `app.json` and (for seven) `icon.k64` on /storage; each of the nine is launched by touch from the "All" list (scrolled), shows a non-black first screen (buttons_led: its green LED, it has no screen), and returns with the bottom-button hold; a tag saved in NFC (`/storage/nfc_kit/saved.bin`) is still in Saved after going back to kodeOS, a power cycle and a relaunch. Screenshots in `docs/boot-shots/`: `factory-list-0..3.png` (the whole list, scrolled), `app-<name>.png` (nine first screens), `factory-back-in-kodeos.png`, `factory-nfc-name.png`, `factory-nfc-saved-after-relaunch.png`.

Home hold times measured (press to kodeOS running, includes about 1 s of restart): the six starter apps 4.4-4.7 s (the SDK's 3000 ms hold), Kody Kart 2.4 s (its own `HOME_HOLD_MS` is 1000 ms, `kart_ao.c`), display_lvgl 1.3-1.5 s (built without the home hold: AO_Boot's ordinary 600 ms hold), buttons_led about 1.3 s (it resets on the press itself).

## Rough edges

a. App size "1 KB" in kodeOS's details card: NOT fixed, where the fix belongs. kodeOS shows `kapps_list` entry size = the length of the synthesised image (432 bytes, `synthImage` in `runtime/web-adapter/kapps.js`). Showing the package size means padding each image to the real size, but the nine apps are 4.87 MiB and the apps region is 0x410000 (4.06 MiB), AppMgr also copies every image to /sdcard/<project>.bin (size bytes each). It needs a bigger apps region (6 MiB or more: heap budget is 96 MB of which about 35 MiB are static regions), then padding in `synthImage`, then a look at SD copy time. Lying only in the directory entry is unsafe (AppMgr reads `size` bytes).
b. Display pacing: done. `kdrv_display_web.c`: a FLIP (flush of one of the two framebuffers) completes at the next boundary of a 60 Hz grid, as on the panel (`on_frame_done`); chunk copies still complete at once, as the real transfer-done does. Kody Kart `fps` log: 726 before, 59-60 after. All suites above ran with it. `-DDOTBENCH_NO_DISPLAY_PACING` restores instant completion.
c. Hold timing in Chrome ("back after 1763 ms"): not a clock fault. Kody Kart's own home hold is 1000 ms plus the restart. Firmware time is derived from CLOCK_MONOTONIC (1 tick = 1 ms; the QP tick drops ticks when late, so it can run slow, never fast); in Node "bottom held 600 ms" is logged 633 ms after the press and the 3000 ms hold fires at 3.0 s. Not measured separately in Chrome beyond the browser boot test passing.
d. Persist dirty counter: fixed, see 6 above. Any other writer that marks dirty without a change will still defeat the debounce; the check is `dbpx_gen` over 10 s of kodeOS idle (now 0).

## Flaky, stand-ins, risks

- Timing tests flake when the machine is loaded (boot hold timing, nfc persist once). Run the boot and Chrome suites on a quiet machine; the full Node run takes about 45 minutes here.
- Still stand-ins: BLE (kdrv_ble stubbed, "not implemented" log lines in kodeOS), synthesised app images (no SHA-256, sizes 432 bytes), region sizes differ from the board, E5 station/camera/PPA/JPEG stubs, `kdrv_slot_*`.
- First boot: AppMgr copies the nine apps to the card one per second, about 10 s of load after the first frame; swipes in the list lag until it ends (the factory test waits for it).
- After an app has run, kodeOS's group list shows it as a shortcut tile on top, so "All" is lower (y 170 instead of 72): touch tests must know.
- The Node `system/restart` rss check fails here with old and new packages.
