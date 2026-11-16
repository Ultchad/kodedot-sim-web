# STATUS - 125 kHz RFID area (branch area/rfid)

Result: `tests/node/run.sh rfid` passes from a clean seeded build dir (168 scenario checks in 6 rfid test files, plus the two stage-0 acceptance tests and the RTOS unit tests).

## Seam and why

The SDK's real `kdrv_rfid_lf.c` is compiled **unmodified** (the "supersedes" entry is removed from area.json; stub count 417 -> 392). Everything above it runs for real: the EM4100 decoder, the T5577 clone/programming routine, the emulation loop builder, `AO_Rfid`, `kode_*` calls and the example app.
Faked is the layer under it, i.e. the ESP-IDF peripherals: `adc_continuous` (envelope samples paced at 80 kS/s), `parlio_tx` (emulation bit stream, read by the bench door reader), `pulse_cnt` (field frequency measurement), `esp_ldo`, `gpio`, and the `khal_pwm_port_*` layer under the SDK's own `khal_pwm.c` (LEDC; a timer pause/resume is the T5577 write gap). Going lower than kdrv (the kdrv API) was not needed.

Virtual clock: inside kdrv_rfid_lf.c's translation unit only, `esp_rom_delay_us` and `vTaskDelay` are redirected (via `include/esp_ldo_regulator.h`, guarded by `KDRV_RFID_LF_H_`) to a clock that advances virtual microseconds while still really sleeping. The T5577 gap decoder reads it (start gap >= 200 us, write gap 144 us, on-time >= 320 us = bit 1).

Bench objects (C, `rfid_bench.c`): EM4100 card, rewritable T5577 (8 blocks, lock mask, write-protect, boost requirement; blank config 0x000880E0, EM4100 config 0x00148040), door reader (independent EM4100 decoder of the PARLIO stream, +-10% timing tolerance, optional poll delay). The bench encoder is independent of the SDK's.

## Exported C API (area.json; all safe from the host thread: one mutex held for microseconds, no blocking)

rfid_world_reset, rfid_obj_create, rfid_obj_remove, rfid_obj_near, rfid_obj_is_near, rfid_obj_leave_after (scripted removal after N blocks or samples), rfid_card_set, rfid_t5577_set, rfid_t5577_get, rfid_obj_id, rfid_reader_set, rfid_reader_get, rfid_fault_set (bit1 ADC dead, bit2 carrier will not start), rfid_state, rfid_poll, rfid_ev_pop, rfid_frame (C encoder, for cross-checking).

## JS API (`rfid.js`, default export `(ctx) => api`)

Pure named helpers: parseId, formatId (hex, plain, dec10, version, number, facility-card), idFormats, encodeFrame (BigInt, 64-bit), frameBits, decodeFrame, T5577_CONFIG_EM4100, T5577_BLANK_CONFIG, blocksForId, idFromBlocks.
Api: createCard/createTag/createReader, update, remove, bringNear, takeAway, isNear, get, list, carrier(), emulation(), setFault({adcDead, noCarrier}), poll(), reset().
Events via `ctx.emit`: carrier, boost, card-read, block-written, tag-written, write-rejected, emulation, reader-saw, field-measured, object-left. Options leaveAfterBlocks / leaveAfterSamples.

## Scenarios (all PASS)

| Scenario | File | Result |
|---|---|---|
| Unmodified examples/rfid_read end to end (TOP button) | example_rfid_read | PASS |
| EM4100 frame encoder vs 7 hand-derived vectors, 300 random IDs, decode errors, formats, C-vs-JS on 207 IDs | em4100 | PASS |
| Read with no card (timeout as the API defines) | read | PASS |
| Card present; formats; RF/16 and other rates | read | PASS |
| Card removed mid-read; two cards in a row | read | PASS |
| Write then read back (T5577) | write | PASS |
| Write with nothing present; with a non-writable EM4100 card; protected/locked T5577 | write | PASS |
| Emulate start/stop, door reader observes the ID; field detection; replacement ID | emulate | PASS |
| Cancel / stop; AO API (async) ops, busy rule, DENIED cases | ao_faults, emulate | PASS |
| Faults: ADC dead, carrier cannot start (bounded time, recovery) | ao_faults | PASS |

Own app: tests/node/rfid/apps/rfid_api (console functions read, write, emu, emustop, isemu, aread, awrite, aemu, aemustop).

## Assumptions

- A physical card is "near" or not (no range model); 125 kHz class frequencies use the external clock, 62.5 kHz halves the loop.
- Envelope levels (unloaded 2600, loaded 2000, noise +-10) and T5577 timings are bench-chosen to satisfy the real decoder, not measured from hardware.
- Objects live in the C world and must be recreated after an app restart.

## Doc/code disagreements

- The task-level `kode_rfid_read_id` / `kode_rfid_write` do not report "RFID is busy" when an AO ask holds the front end (the facade's busy flag is only set by the blocking calls): the call waits its time and fails as timeout (read) or generic write failure. The ao_faults test asserts this actual behaviour.
- `AO_Rfid` folds every failed read/write window (no carrier, ADC dead, no card) into KODE_TIMEOUT, so those cases are indistinguishable at API level.
- No cancel API exists for a running read; cancel is by timeout or by the AO stop path.
- The cert API is compiled out in this SDK build.
- gen_stubs prints "cannot preprocess kdrv_fs.h" during seed (pre-existing, not RFID).

## Requested shared-file changes (not made)

1. `runtime/drivers/rfid/include/` is on the global include path and holds shim headers (driver/gpio.h, driver/parlio_tx.h, driver/pulse_cnt.h, esp_adc/adc_continuous.h, esp_ldo_regulator.h, soc/soc_caps.h placeholder). NFC or other areas adding the same names would collide; suggest the build give each area its include dir only to its own sources, or agree on who owns soc/soc_caps.h.
2. `khal_pwm_port_*` are defined weak in rfid_idf.c (prototypes restated locally, khal_pwm_port.h is private). If another area fakes the same layer, one must own it.
3. tools/dblib/__pycache__ .pyc files change on every run; they should be gitignored (not committed by me).

## Risks

RF/16 timing limits and flakes under heavy load on a 2-core machine (ADC is real-time paced, 20 ms event tick in tests); the debug of one-off event drain races was handled with explicit `rfid.poll()`.

## Final passing output (clean seeded dir, `tests/node/run.sh rfid`; per-check "ok" lines omitted, all 168 are ok)

```
== dotbench sdk
gen_stubs: cannot preprocess /home/claude/src/kode-sdk/components/kdrv/storage/include/kdrv_fs.h:

  [stubs] 25/33
[stubs] 33 files, 33 compiled, 0 failed
dotbench sdk: done (284 real SDK files, 277 LVGL files, 392 stub functions)
== dotbench build buttons_led
dotbench build: /tmp/rfid-clean2/apps/buttons_led/buttons_led.dotbench (110514 bytes)
== dotbench build display_lvgl
dotbench build: /tmp/rfid-clean2/apps/display_lvgl/display_lvgl.dotbench (390931 bytes)
== dotbench build rfid_read
dotbench build: /tmp/rfid-clean2/apps/rfid_read/rfid_read.dotbench (121176 bytes)
== dotbench build rfid_api
dotbench build: /tmp/rfid-clean2/apps/rfid_api/rfid_api.dotbench (133787 bytes)
== rtos unit tests
85 checks, 0 failed
ALL PASSED
== acceptance/buttons_led.test.mjs (Node)
buttons_led: PASSED
== acceptance/display_lvgl.test.mjs (Node)
display_lvgl: PASSED
== rfid/ao_faults.test.mjs (Node)
ao_faults: PASSED
== rfid/em4100.test.mjs (Node)
em4100: PASSED
== rfid/emulate.test.mjs (Node)
emulate: PASSED
== rfid/example_rfid_read.test.mjs (Node)
example_rfid_read: PASSED
== rfid/read.test.mjs (Node)
read: PASSED
== rfid/write.test.mjs (Node)
write: PASSED
ALL TESTS PASSED
```
