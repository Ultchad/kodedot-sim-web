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
4. First boot: if the persisted `apps` region and the bundle registry are empty, the system installs the factory list through the directory-update code (once; marked seeded, so a deleted factory app stays deleted until `factoryReset()`).
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
