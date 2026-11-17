# STATUS: apps inside kodeOS (area/boot)

Installed apps appear in kodeOS's own launcher through the real AppMgr, the real Boot AO and the real `kdrv_apps.c` (format, directory, request record). The adapter plays the bootloader.

## What works (commands and counts)

| Command | Result |
|---|---|
| `tests/node/boot/run.sh` (builds kodeOS, kody_kart, display_lvgl, buttons_led, crash test app) | `format.boot-test.mjs` 11 checks ok; `boot.boot-test.mjs` 11 checks ok |
| `tests/browser/boot/run.sh` (headless Chrome, IndexedDB, blob workers, COOP/COEP) | 3 checks ok |

Covered: first boot seeds the factory set (names, versions, categories, icon.k64 on /storage); a tap in the launcher goes kgui -> appmgr_run_request -> AO_Boot -> KRUN request -> restart -> the adapter's bootloader boots the bundle with the same persisted regions; Kody Kart title frame; BOT held 3000 ms returns to kodeOS which logs FROM_APP; run-time install and delete (API and kodeOS's own Remove button) both survive a reload; BOT+LEFT retires the request; an app crash returns to kodeOS; a sticky (ALWAYS) request survives the keep-list of reset causes; factory reset.

Screenshots (`docs/boot-shots/`): 01 launcher first boot, 02 Kody Kart title, 03 back in kodeOS, 04 list after install, 05 details card with Remove, 06 list after reload, 07 Kody Kart from the Chrome run.

## Pieces

- `runtime/drivers/apps/`: `apps_flash_web.c` (esp_partition shims over persisted regions `apps` 0x410000 and `app-pending` 1 MiB, complement storage), `slot_web.c` (`kdrv_otadata_blank` true), `testapp/` (crash_app). The real `kdrv_apps.c` is no longer superseded.
- `runtime/web-adapter/kapps.js` (directory/request codec, install planner with 64-entry eviction, synthesised images, `tryBootRequestedApp`), `bundles.js` (host-only region `dbsys`: the .dotbench bytes), `dotbench-system.js` (`DotbenchSystem`), `persist.js` (+`regionRead/regionWrite`), `dotbench-device.js` (package cache, Node loading), `factory.js`.
- `tools/dotbench build` packs project name, version (`set(PROJECT_VER ...)`), manifest name and categories, `appdata/app.json` and `board/icon.k64` (via KodeOS `tools/kappdata.py`, unmodified; helper `tools/dblib/appdata.py`).
- Where the radio supersedes live: `runtime/drivers/kodeos_boot/area.json` was not touched by this area (the five radio entries are still lines 9-13 there).

## DotbenchSystem API

`new DotbenchSystem({os, persist, factory:{apps:[names], fetch(name)}, pollMs})`; `start()`, `stop()`, `dispose()`; `install(bytes)` -> `{id}`; `list()` -> `{id, project, name, version, category, size, hasBundle}`; `remove(id)`; `launch(id)`; `home()`; `factoryReset()`; `powerOnReset()`. Events via `on`: `program` `{id,name,kind:"os"|"app"}`, `status`, `apps`; device events (log, outputs, ...) are forwarded. Delegates: `frame/copyFrame/frameSeq`, `button`, `touch`, `outputs`, `lines`, `area`, `persist`, `flushPersist`, `exportDeviceFile`. Works in Node and browser.

## Page wiring (for the web engineer)

1. Replace `new DotbenchDevice(...)` with `new DotbenchSystem({os, persist, factory})`. The page never sees restarts: it keeps one object, listens to `program` to label what is running, and keeps reading frames and outputs from the same object.
2. Bundle in `public/apps/`: `kodeos.dotbench` (the OS), the factory packages `kody_kart.dotbench`, `display_lvgl.dotbench`, `buttons_led.dotbench`, and `factory.json` = `{"format":1,"apps":["kody_kart.dotbench","display_lvgl.dotbench","buttons_led.dotbench"]}`. Adding a factory app later = add the file and one list entry.
3. `factory.fetch = (name) => fetch("/apps/"+name).then(r=>r.arrayBuffer())` as Uint8Array; `factory.apps` = `factory.json`'s list.
4. Factory set: installed on the first boot and kept up to date on every later start (section "Updates and factory resets" below).
5. Opening a `.dotbench` the user picks: `sys.install(bytes)` (kodeOS reboots once to pick it up), then `sys.launch(id)` if wanted. Removal from the page: `sys.remove(id)`; kodeOS's own Remove works too.
6. Needs the same COOP/COEP headers as before; persistence backend is the existing `IdbBackend`; give it a store name (do not share with the single-app page).

## Stand-ins and unverified

- Images in the apps region are synthesised (valid ESP header, app desc, KAPD); no SHA-256/signature check in `esp_image_verify`; slot, kfw and image_check are stubs.
- Region sizes (0x410000 apps, 1 MiB pending) differ from the board's.
- Run-time install and delete via the API reboot kodeOS; the mailbox path adopted by the real AppMgr (stretch goal) is NOT done.
- A sticky (ALWAYS) request makes the app reboot into itself on a software reset (as on the device).
- An OS crash is shown as "crashed", not rebooted.
- AppMgr copies each app to /sdcard/<project>.bin itself (its own backup behaviour).
- crash_app in Chrome surfaces the worker abort as a page `ErrorEvent`; the test tolerates exactly that.
- 64-entry eviction is covered by the format tests at codec level only.

## Shared-file notes

- `tests/browser/run.sh` does not run the boot check (outside this area): add `tests/browser/boot/run.sh`. Same for `tests/node/run.sh` and `tests/node/boot/run.sh`.
- Launcher group order: kgui re-focuses the last used group, so test taps depend on it.

## Risks

Cold builds are slow under load; kodeOS cold boot in Chrome about 10-20 s; the Node boot suite takes about 2 minutes.

## Regression runs (this branch, base before the integ/persist test hardening)

`tests/node/run.sh`: 442 ok lines; acceptance, audio, haptic, sd, nvs, persist, rtos pass. Three load-sensitive checks failed when two suites ran at once (storage examples button presses, system/restart rss growth, time/clock); the rss one fails identically on integ/persist, the storage and time ones pass when run alone, and the storage one is the flake integ/persist already hardened (`pressUntil`). `tests/node/kodeos/run.sh`: 13 ok (the empty-launcher check still passes). Run the boot, kodeOS and Chrome suites on a quiet machine.

## Updates and factory resets

**Update rule** (`DotbenchSystem._syncFactory`, runs in `start()` and after a factory reset, before kodeOS boots; the store is `bundles.js`, index key `factory`):
the store remembers, per listed package (`light.dotbench`), `{project, hash (sha-256 of the package = the bundle id), removed?}`. At each start, for every entry of `factory.apps`:

| situation | action |
|---|---|
| no record, not installed | new: installed, recorded (first boot, an app the site added later, a store from before records) |
| no record, installed, the store has no records at all (old store / first boot of an imported device) | adopted; replaced if its bytes differ (it is the old factory build) |
| no record, installed, the store has records | the user's own app of that name: left alone (reported in `kept`) |
| record, not installed | the user removed it: `removed: true`, stays removed until a factory reset (also when the site ships a changed package for it) |
| record, installed with another build than recorded | the user's own build: left alone (`kept`) |
| record, installed, package hash changed | replaced in place (same directory-update code, old bundle dropped); `/storage/.kode/appsdata/<project>` keeps the app's data, only `app.json`/`icon.k64` are rewritten when they differ. The app moves to the end of kodeOS's list (the directory is in install order) |

Apps installed by the user under other names are never looked at. A package that cannot be fetched is skipped (`failed`) and tried again next start; nothing is marked. `factory.apps` entries may be `{package, sha256}`: with a hash equal to the record the package is not downloaded at all (the page can add it to `factory.json`; plain names still work and cost one cached fetch per app per start). Result: `sys.lastUpdate` = `{installed, updated, removed, kept, failed, os}`, event `update` when something happened.
**Migration:** a store from before this change has only `seeded`, no `factory`: every listed app that is missing is installed (the owner's browser gets the six new apps on its next visit), installed namesakes are adopted. An app the visitor had removed in the old store comes back once (nothing recorded it).
**kodeOS:** its bytes are never stored; `_boot` always loads the `os` the page passed to the constructor (device cache key `os:<hash>`). The store records the OS hash; a change is reported as `update.os = {from, to}`. NVS and files are not touched by any update. The page must serve `kodeos.dotbench` so the browser does not hand out an old copy (no long-lived cache without a hashed name).

**Factory reset from kodeOS** (Settings -> About -> Factory reset). AO_Boot steps: find the welcome app, link, wipe (AO_Radio: vault, BTKEYS, BLE bonds), apps (AppMgr removes all), files (AO_Storage removes app images and `/storage/.kode/appsdata/*`, SD included), nvs (every namespace but identity and station lock), then `boot_restart()`. What stopped it: `kdrv_ble_unpair` (the superseded `kdrv_ble.c`) was a generated stub that fails; with no BLE host there are no bonds, so it now answers `KODE_OK` ("nothing to forget") in `runtime/drivers/kodeos_boot/internal_stubs.c`, the stub layer of the role that supersedes kdrv_ble.c (a BLE area would replace it; the radio area is the C5 link and has nothing to say about bonds). The apps step also calls `kfw_appdata_release`/`take` (kdrv_kfw.c is superseded by the apps area): `runtime/drivers/apps/kfw_appdata_web.c` has their real bodies for an empty session. The other steps already passed (vault and BTKEYS over the C5 fake, NVS erase, storage clear, the SD copy of the images, no welcome app: "it ends in kodeOS").
The restart is a plain software reset. The adapter watches kodeOS's log for `factory reset: restarting into` (printed before the restart request is read); at the next boot it forgets the factory records, drops the orphaned bundles and runs the sync as a first boot: the factory apps are back, user apps and the "removed" marks gone, event `factory-reset {by:"os"}`. It does NOT erase what the OS keeps (identity cache, files outside the apps' data folders, the SD card's other files, bench objects); `sys.factoryReset()` (the page's) erases the whole device.
Test: `tests/node/boot/reset.boot-test.mjs` (touch through the controls sheet, Settings, About, Factory reset, Reset; 3 checks) with `docs/boot-shots/reset-1..5`. Updates: `tests/node/boot/update.boot-test.mjs` (5 checks); browser: one IndexedDB check in `tests/browser/boot/boot.test.mjs`.

## The uncaught "ExitStatus" in the page

Seen in about 1 of 5 runs of `web/scripts/system-check.mjs` (reproduced here, 1 in 5 and 1 in 10, stack: `quit_ <- _proc_exit <- exitJS <- exitOnMainThread <- __emscripten_receive_on_main_thread_js <- wasm frames`). Cause: when the firmware's last thread leaves (libc `exit()` after the last `pthread_exit`) a worker cannot exit the process, so Emscripten proxies `exitOnMainThread` to the main thread, which throws `ExitStatus` (a plain object, not an Error). Normally the throw lands in Emscripten's `callUserCallback`, which handles it. If the main thread is inside wasm at that moment (a mutex/futex wait in one of the page's calls: poll, button, console, an area call, a persist harvest) the queued call runs from that wait and the exception unwinds through the page's own timer/promise callback: uncaught `pageerror: ExitStatus`. Teardown (launch, home, install, remove, reset, stop) is when threads leave. Workers never throw it (their `exit` is the proxied call); worker failures reach the page as ErrorEvents and are real crashes, left alone.
Fix: `guardExports(M)` in `dotbench-device.js` wraps every `M._name` export the host calls (right after the module is created, before persist/glue/polling take them) so that exactly an `ExitStatus` object is swallowed (recorded in `device.exitStatus`) and everything else is rethrown; the `Atomics.waitAsync` continuation does the same. Tests: `tests/node/boot/guard.boot-test.mjs` (6 checks: swallows only ExitStatus), `tests/browser/boot/teardown.test.mjs` (20 launch/home cycles with 0 to 1.5 s in the app, then install, remove and factory reset; any `pageerror` or `console.error` fails; passed 3 of 3 runs before and after). Caveat: the race is rare and was not forced deterministically, so the browser test can pass without the guard; the unit test pins the behaviour and the 1-in-5 repro (system-check) was not re-run against the fixed adapter (the page's dist bundles the old adapter: rebuild web/ to pick it up).
