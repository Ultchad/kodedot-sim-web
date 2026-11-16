# Integration of persistence into the whole project: status

Branch `integ/persist` (worktree `/home/claude/wt/integ`). Merges `area/persist`, the kodeOS/NFC/audio follow-ups and `main`
(kodeOS as the page default, preview image, bundled Kody Kart; web/ only, merged without conflicts).

## Items

| # | item | state | evidence |
|---|---|---|---|
| 1 | area/persist merged | done | `git log --oneline main..HEAD`; `KWEB_PERSIST_MAX` is 16 |
| 2 | kodeOS on the real storage | done | `kodeos_boot/storage_memfs.c` is gone; `/storage` is the FatFs volume on region `flash-fs`; a blank volume is formatted and seeded once from the package's `factory/storage/**` (`vfs.c` `seed_locked`, host side `web-adapter/factory.js`, log line `factory content: N files`); `tests/node/kodeos` (13 checks: restart, power cycle, erase) and `tests/node/storage/factory.test.mjs` |
| 3 | NFC state on `dbp_register` | done | `nfc_bench.c` registers `"nfc"` and marks the region dirty at every `nfc_unlock`. Added `tests/node/nfc/persist.test.mjs`: a page-made tag reaches the backend through the dirty flush with no stop, and is there after stop + new boot. (Existing `missing.test.mjs` only covered the legacy snapshot Map.) |
| 4 | audio file tests | done | `tests/node/audio/files.test.mjs` (WAV play, record to file, refusals, full volume, SD pull) |
| 5 | suites green | done | see the summary below |
| 6 | this file | done | |

## What I found and changed (tests only, no firmware or shared-file change)

Running the suites on a host with load average 15 to 35 exposed four timing flakes, all in tests, none in firmware:

* `tests/node/storage/examples.test.mjs`: 80 ms button presses were lost on a starved host, and the SDK demo ignores a press while a write holds its buffer. Presses are now held 250 ms, the bottom-button read and each write are re-pressed until the firmware reacts (only the input is retried; every assertion on what the firmware does is unchanged), and the second write waits for the first one's answer.
* `tests/browser/persist.test.mjs`: a fixed 1.8 s sleep before checking the debounced flush; now polls up to 15 s for the same assertion.
* `tests/node/time/time.test.mjs`: compared the clock with the target within 8 s, but the clock runs during slow boots; now compares with target plus elapsed time within 2 s (stricter).
* New `tests/node/nfc/persist.test.mjs` (above).

Not touched: `runtime/drivers/kodeos_boot/`, `runtime/drivers/apps/`, `runtime/web-adapter/`, `tools/dotbench` (area/boot works there).
`tests/browser/browser.test.mjs` finds puppeteer-core only in `<worktree>/web/node_modules` or by name: in a worktree without `npm install` run the browser suite with `NODE_PATH=/home/claude/dotbench/web/node_modules` (persist and audio tests already fall back to that path).

## Still a stand-in or missing

* kodeOS apps region and OS update path (`kdrv_apps`, `kdrv_slot`, `kdrv_kfw`, `kdrv_image_check`): stubs; the launcher shows "No apps yet". Owner: area/boot.
* Power/PMIC, radio/Wi-Fi/BLE/IR, display extras: stubs (STATUS-kodeos.md).
* `.kode/appsdata/onboarding` and `c5_slave.bin` not generated (private or needs ESP-IDF).
* **The page does not use persistence yet**: `web/src/device/wasm.ts` does not create a `DotbenchDevice({persist})`, so in the page nothing survives a reload until it does (web/ was out of scope).
* **`web/public/apps/kodeos.dotbench` (from main) was built with the removed MEMFS stand-in** (1.53 MB; the new build is 1.36 MB). Rebuild it (`web/scripts/prepare-apps.mjs`) after fast-forwarding, or kodeOS in the page will not persist.
* Also open (from STATUS-persistence): no JS FAT reader (files reachable only while the device runs), no "load card image" helper, Chrome only.

## How the page should use the persistence API

```js
import { IdbBackend } from ".../persist-idb.js";
const dev = new DotbenchDevice({ persist: new IdbBackend("dotbench") });   // before anything boots
navigator.storage?.persist?.();                    // ask the browser not to evict (store is up to 34 MiB worst case)
await dev.start(pkg);                              // regions are loaded BEFORE main(); first boot seeds /storage
dev.addEventListener("persist:error", ...)         // quota errors: data stays in memory, next flush retries
await dev.flushPersist();                          // "save now" button; stop()/restart always commit fully; pagehide is best effort
const bytes = await dev.exportDeviceFile();        // whole device (NVS, files, SD, clock, nfc, ...) as one file
dev.stop(); await dev.importDeviceFile(bytes);     // import needs the device stopped
await dev.eraseDevice();                           // stops, forgets memory and IndexedDB: next boot is factory fresh (and re-seeded)
```
Page-side files while running: `dev.area("storage").list/read/write/mkdir/...`, clock `dev.area("time")`, card `dev.area("sd")`.
Details: STATUS-persistence.md sections 2 to 6, runtime/web-adapter/README.md.

## What the boot engineer needs to know

* kodeOS sees `/storage` (2024 KB FAT12 on region `flash-fs`) and `/sdcard` (virtual card, region `sd-card`) through the real `kdrv_storage.c`; libc file calls on those prefixes are redirected by the shadow `dirent.h` to `vfs.c`. Settings are in region `nvs` (64 KiB). Clock offset and SD slot state are in `dev-state`.
* First boot: `kdrv_fs_web.c` mounts, formats a blank volume and seeds it from the package's `factory/storage/**` once (Kody's pack, 324 KB, in `/storage/kode`). It never seeds again, even with a different tree; `eraseDevice()` makes the next boot blank and seeds again; an explicit format means empty.
* Where an installed app would live: the app image belongs in the `apps` region (kdrv_apps), which you add with `dbp_register("apps", buf, size, 0)` (STATUS-persistence section 7: size multiple of 4096, fixed per build, well under 16 MiB, mark dirty AFTER writing). Its data and assets are plain files: `/storage/.kode/appsdata/<app>/` and the install staging dir `/storage/kode.new`. If you keep installs as files instead, mind the 2024 KB volume.
* Region budget: 16 in the dbp table (now used: nvs, dev-state, flash-fs, sd-card, nfc, keep; keep is RETAIN). ~35 MiB of the 96 MB wasm memory is static regions.
* Two areas of one role superseding the same SDK file is a build error naming both; `kodeos_boot` no longer supersedes `kdrv_fs.c`, do not add it back.

## Final passing summary

Node (`tests/node/run.sh`, from the final tree, log of the run):
```
85 checks, 0 failed (rtos)            buttons_led, display_lvgl PASSED
audio: example_audio, files, layout, record, tone_volume PASSED
haptic 10+6, motion 19+8, power 13+7 ok, 0 failed
nfc: cards 13, emulation 11, glue 7, missing 6, nfc_read 11, tags 18 checks, persist PASSED
rfid: ao_faults, em4100, emulate, example_rfid_read, read, write PASSED
nvs (20 restarts, 50 kills, 40 torn writes, SDK cases x3), persist, sd, storage (api, examples, factory, powercut), time
system: areas_conflict, restart PASSED
ALL TESTS PASSED   (487 "ok" lines, 0 FAIL)
```
kodeOS (`tests/node/kodeos/run.sh`): 13 ok, `KODEOS TESTS PASSED`.
Browser (`NODE_PATH=... tests/browser/run.sh`): browser 13 ok, persist 5 ok, audio 8 ok, `BROWSER TESTS PASSED`.
