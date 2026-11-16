# kodeOS in dotbench: analysis and build plan for stage 1b

Status: read-only analysis. Nothing in /home/claude/src/* was modified or built.
Convention: statements marked **[doc]** come only from https://docs.kode.diy/internals/* and were not
confirmed in code. Unmarked statements were read in code (paths relative to
/home/claude/src/KodeOS = `KOS`, /home/claude/src/kode-sdk = `SDK`). Items marked **[unverified]** were
not read or not run and are listed again in section 7.

## 0. Summary of findings

1. SDK version gap. `git -C KOS ls-tree HEAD sdk` pins `0910112`. The local kode-sdk checkout is at
   `c9568a3` and is a one-commit shallow clone: `git cat-file -t 0910112` fails (object absent). So
   the local SDK is not the commit kodeOS was built against, and `git log` cannot show the gap (it has one
   commit). KodeOS's own commit message names three features taken from the newer SDK. Whether kgui builds
   against c9568a3 is **unknown** until tried; the first task of the plan is a compile probe (T0).
2. kodeOS is the same SDK plus a large GUI component (kgui, LVGL 9.6.0 with mandatory ThorVG/Lottie),
   built with role `BOOT_ROLE_OS`, and starts every AO an app does not.
3. Apps are whole firmwares. The boot model is a 20-byte boot request record in the apps flash region,
   consumed by a custom second-stage bootloader on reset. The web equivalent is straightforward because the
   page can play the bootloader (section 2).
4. Build extras needed beyond an SDK app: C++ (ThorVG), kgui sources and LVGL, cJSON, an inflater,
   the apps/storage flash model and the pieces of kdrv_apps that the foundation stubbed (section 1.8).
5. Minimal fake areas to reach the lock screen: display+touch+buttons, ioexp, storage (FAT tree), nvs
   (persistent), system/time/reset, power reading (any value), apps region (read side), keep (reset-cause).

## 1. Build anatomy of kodeOS

### 1.1 Entry and config
- `KOS/CMakeLists.txt`, `KOS/main/main.c`, `KOS/main/CMakeLists.txt`: IDF project; main calls `kode_init()`.
- `KOS/sdkconfig.defaults` sets: BOOT_ROLE_OS, WELCOME_APP "onboarding", LV_USE_THORVG, LV_USE_LOTTIE,
  LV_USE_SNAPSHOT, TEST_DOT=y, KODE_LOWPOWER=y with LOWPOWER_IDLE=n, SCHEDULER=y, C5_HOLD=y, BT_ENABLED=y,
  LV_DEF_REFR_PERIOD=33.
- Differences versus the app profile dotbench already generates (`tools/gen_sdkconfig.py`): the role, the
  GUI/LVGL options, TEST_DOT, SCHEDULER, BT. `CONFIG_KODEOS_HOME_HOLD` is app-only; kodeOS has no home hold.
- Partition table: `SDK/components/kbsp/partitions.csv` (board config `kbsp/sdkconfig.board`). The apps region
  is a data partition with a 6 MB mailbox `app_pending` at 0x1A00000; the OS-intent word sits at +0x5FF000.

### 1.2 SDK components compiled into kodeOS vs an app
`kode_init` row order (`SDK/components/kode_sys/kode_sys.c:116-171`): boot, lowpower, scheduler, storage,
appmgr, ioexp, buttons, touch, display, early GUI, radio, net, ledmgr, owners, console, testdot, power.
An app (BOOT_ROLE_APP) links only the core AOs (log, boot, power, ioexp, buttons) plus those it uses.
kodeOS therefore adds: lowpower, scheduler, storage, appmgr, touch, display, kgui, radio, net, ledmgr,
console, testdot, plus audio/imu/haptic/nfc owners as claimed by kgui screens (claims in
`SDK/components/kaos/core/src/kaos_claim.c`).

### 1.3 kgui
- `KOS/components/kgui/{CMakeLists.txt,Kconfig,idf_component.yml,kgui_ao.c,kgui_icon.*,sim/,test/run.sh,screens/*}`.
- Pins LVGL 9.6.0 (`idf_component.yml`). `kgui_ao.c:102` has a hard `#error` if `LV_USE_LOTTIE` is off, so
  ThorVG is mandatory; it is C++ (about 47 .cpp files) and needs an `em++` path in `dotbench build`.
- `kgui/sim/` and `kgui/test/run.sh` are an existing host simulator (SDL-style); useful as a reference for
  what kgui needs from the platform and as a cross-check of screenshots.
- kui is used for the Kody (pack-driven animated character) via `SDK/components/kui` (`kui_pack.c` includes
  cJSON.h; `kui/sim` exists). Kody JSON packs are zlib-compressed (`khal_zlib_decompress`, see 1.8).

### 1.4 Fonts, images, generated assets
Generated assets and their generators live under `KOS/tools` and kgui's CMake: **[unverified]** the exact
asset list (kgui_assets pack loader not read). The plan treats "assets compile as plain C arrays in
kgui" as the working assumption; T0 verifies. Reference tools in KOS/tools: `mkapps.py` (region image),
`kappdata.py` (icon.k64), `kcli.py` (appdata put flow).

### 1.5 Options that change what is compiled
Kconfig sources: `SDK/components/{kdefs,kaos,khal,kscreen,kqp}/Kconfig`, `KOS/components/kgui/Kconfig`.
Effective set for kodeOS is in sdkconfig.defaults (1.1). The generated dotbench header
`/tmp/kcfg/sdkconfig.h` (scratch, from running gen_sdkconfig.py) was used to compare; T0 regenerates it
with the kodeOS profile (`dotbench build --profile kodeos`, see 6).

### 1.6 Generated files
`sdkconfig.h`, `app.h` (dotbench), kgui asset arrays (assumed), ThorVG config header. kodeOS itself has no
other generated sources that were found.

### 1.7 What `dotbench build` needs beyond an SDK app
- A `kodeos` profile in `tools/gen_sdkconfig.py` and a source list for kgui+LVGL+ThorVG+kui (the REPLACED list
  is in `tools/dblib/sources.py`).
- An `em++` compile path for ThorVG with `-fno-exceptions -fno-rtti` (Emscripten pthreads).
- LVGL draw backend: software only; ThorVG software raster.
- Memory: kodeOS plus LVGL plus Lottie needs far more than a small app; initial memory and pthread pool
  size must be raised (risk R4).

### 1.8 External pieces absent offline
- cJSON: required by `kui_pack.c`; no copy found under /home/claude. Vendor it (MIT) into
  `third_party/` or gate Kody off with a stub (kody is a visual extra).
- zlib/inflate: `khal_zlib_decompress` (`SDK/components/khal/zlib/include/khal_zlib.h`) is stubbed by the foundation;
  the ESP version uses the ROM tinfl (`khal/zlib/src/khal_zlib_esp.c:14-38`, flags PARSE_ZLIB_HEADER |
  HAS_MORE_INPUT | USING_NON_WRAPPING_OUTPUT_BUF). Emscripten 7.0.0 has no libz in its sysroot and its ports
  cache is empty, so `-sUSE_ZLIB` would need the network. Options in order of preference:
  1. implement the fake with LVGL's bundled `lodepng_zlib_decompress` (declared at
     `/home/claude/src/third/lvgl/src/libs/lodepng/lodepng.h:1040`; allocates its output, so copy into the caller's
     buffer and compare to `json_len`). Needs `LV_USE_LODEPNG` compiled in; **[unverified]** whether kgui enables it.
  2. vendor miniz's `tinfl.c` (public domain/MIT): same API as the ROM one, so the fake is a near copy of the ESP file.
- kdrv_apps / kdrv_slot / image_check / kfw are stubbed by the foundation; stage 1b replaces them (section 2).
- Headers absent in `runtime/idf`: `esp_partition.h`, `esp_image_format.h`, `esp_ota_ops.h`; needed by kdrv_apps.
- nvs is not persistent in the foundation fake; `khal_keep` (reset-cause keep list) is stubbed.

## 2. The boot model

### 2.1 Device behaviour (code)
Files: `SDK/components/kdrv/apps/include/{kapps_fmt.h,kdrv_apps.h,kapp_desc.h,kapp_data.h,kdrv_slot.h}`,
`SDK/components/kdrv/apps/src/{kdrv_apps.c,kapp_desc.c}`, `kdrv_image_walk.h`,
`KOS/bootloader_components/main/bootloader_start.c`, `SDK/components/kaos/{boot/src/boot_ao.c,appmgr/src/appmgr_ao.c}`.

- **Install.** An app image is written to the mailbox `app_pending` (6 MB at 0x1A00000, partition table
  `kbsp/partitions.csv`) by the computer link; AppMgr adopts it into the apps region
  (`appmgr_ao.c` `region_install` ~2409, `adopt_finish` ~3606, `AppMgr_initial` ~3802). The apps region has
  dual directory copies A/B (generation counter + CRC; CRC is `esp_rom_crc32_le` with seed 0xFFFFFFFF which
  equals Python `zlib.crc32(data, 0xFFFFFFFF)`... use the same seed convention in TS), images aligned to 64 KB, at most 64
  entries, next-fit allocation with FIFO eviction. Format constants in `kapps_fmt.h`. `tools/mkapps.py` is the
  reference implementation for building a region image on the host.
- **Start.** A boot request record `kapps_req_t` (20 bytes, magic "KRUN") lives at apps+0x2000 with states
  NEW, ALWAYS, ARMED, TRIED, EMPTY. kgui calls `appmgr_run_request` -> AO_Boot `BOOT_APP_RUN_SIG` ->
  `kdrv_apps_req_set` (writes the record) -> `leave_begin` (log, net, radio steps; `boot_ao.c` 775-900) ->
  `boot_restart` -> `khal_restart`.
- **Bootloader on reset.** `bootloader_start.c`: `try_boot_requested_app` (128-220) reads the record, validates
  the directory/image, flips NEW to ARMED and maps/boots that image; `call_start_cpu0` (278-314) is the entry.
  The keep list of reset causes is closed; BOT+LEFT is a power-on reset that retires the request.
- **Return to kodeOS.** In an app, BOT held 3000 ms raises HOME_SIG then a 200 ms grace and a restart
  (`kqp/include/kqp_config.h`; **[doc]** says 600 ms, the code says 3000, trust the code).
  `kode_sys_exit_to_os()` is the programmatic equivalent. On the next boot AO_Boot sees TRIED, so the reason is
  FROM_APP. Any other reset also returns to kodeOS because the request is consumed.
- **Image identity.** `esp_app_desc_t` at 0x20 (project name, version) and `kapp_desc_t` ("KAPD" v2) at 0x120.
  The app's data folder is `/storage/.kode/appsdata/<project>/{app.json,icon.k64}`; kodeOS lists apps from the
  directory plus that folder (name and icon come from app.json/icon.k64, with fallback to the descriptor).
  icon.k64 layout: see `tools/kappdata.py` (both sizes mentioned in docs; **[doc]** says 12288 only).
- **Listing, delete, limits.** 64 entries, 64 KB alignment, FIFO eviction, delete = directory update with a new
  generation (code in `kdrv_apps.c`). Message to the engineer: port the logic, do not redesign it.

### 2.2 Web equivalent
- **The page is the bootloader.** A TypeScript module mirrors `try_boot_requested_app` and the keep-list
  decisions. It owns a sparse, sector-based flash model (apps region, mailbox, nvs, storage) persisted in
  IndexedDB (key = sector index, value = 4 KB block; write-back with a flush on `khal_restart` and
  `visibilitychange`).
- **Each program is its own wasm bundle** (kodeOS.js/.wasm, and one pair per app `.dotbench`). The page boots one
  at a time: a reset message from the running program makes the page terminate the worker group, run the bootloader
  logic, then instantiate the chosen bundle with the flash model attached.
- **Synthesised device image.** For an app bundle the page builds an image whose ESP header is zeroed except for
  `esp_app_desc_t` and `kapp_desc_t` with the project name, version and the bundle id (instead of machine code). It
  is placed in the apps region through the same directory-update code as the device. The bundle id in KAPD maps
  to the registered wasm bundle. Name and icon come from `appdata/app.json` and `icon.png` converted to
  `icon.k64` (port `tools/kappdata.py` to TS; the `.dotbench` already carries both).
- **Two install paths.** (a) "device-faithful": the page writes a synthesised image to the mailbox and lets the real
  AppMgr adopt it; (b) "direct": the page performs the directory update itself (used for factory content and the
  console install). Start with (b) for the factory set, add (a) as an acceptance test of AppMgr.
- **Reset handling.** The page detects the BOT+LEFT chord itself (power-on reset semantics: retire the request) and
  the 3000 ms BOT hold in an app is already handled by the app's own firmware code, which calls `khal_restart`.

### 2.3 Driver functions the fakes must implement (names as in the SDK; verify signatures against `driver-surface.json`)
- `kdrv_apps_*`: directory read/validate, list, entry read, req_get/req_set/req_retire, install from mailbox, delete,
  free-space query. Use TS/JS-hosted flash (via EM_JS) and keep the format code in C taken from `kdrv_apps.c`
  where it is hardware independent.
- `kdrv_slot_*` / `kdrv_image_check` / `kfw_*`: minimal accept/reject logic over the synthesised image.
- `esp_partition_*` over the flash model, with `esp_partition_find_first` returning the apps, mailbox and nvs
  partitions at the addresses in `partitions.csv`.
- `khal_keep_*`: survives `khal_restart` (store in the page, not in the wasm heap).
- `khal_restart`, `khal_reset_reason` (returns SW reset, power-on after the chord), `khal_time_*`.
- `kdrv_fs`/`kdrv_storage`: FAT as a file-tree snapshot.

### 2.4 What to persist in IndexedDB
1. flash sectors (apps region, mailbox, nvs); 2. the FAT file tree (path -> bytes) including
`/storage/.kode/appsdata/*`; 3. the registry of installed bundles (bundle id -> wasm/js blobs, manifest);
4. a schema version and a "factory content applied" flag.

## 3. What kodeOS touches at boot that stage 0 lacks

Rows are subsystems; "stub" = what happens today (generated stub logs once and returns a failure). Behaviour on
failure is from code read in `boot_ao.c`, `appmgr_ao.c`, `power_ao.c` (Power_initial 2482), `kaos_claim.c`;
**[unverified]** for AOs not read (audio, imu, haptic, nfc, radio, touch, display, ledmgr).

| Subsystem | Needed fake area | If still a stub |
|---|---|---|
| storage / FAT | `kdrv_storage`/`kdrv_fs` over a file tree | AppMgr cannot read appsdata; app list empty or error screen |
| apps region | `kdrv_apps_*` | AppMgr_initial finds no directory; app list empty (no crash) **[unverified]** |
| nvs | persistent nvs | settings lost each boot; welcome/onboarding re-runs |
| ioexp | I2C expander fake (inputs idle, outputs recorded) | claim failure; log, continue **[unverified]** |
| buttons | event injection from the page | no input; lock screen cannot be unlocked |
| touch | pointer events -> touch driver | touch screens dead; buttons still work |
| display | framebuffer (kweb_state_t) | no output |
| power | any plausible battery/charge values | gauge shows 0; Power_initial may log and continue; **[unverified]** whether kgui asserts |
| radio/net | accept `khal_radio_*`/net calls with "off" | leave_begin steps are guarded by state, expected to skip; **[unverified]** |
| audio/imu/haptic/nfc | benign "absent" | owners skipped; screens may degrade |
| lowpower/scheduler | no-op | idle behaviour differs from device only |
| console | already in foundation (page console panel) | n/a |

AOs started by kodeOS but not by an app: lowpower, scheduler, storage, appmgr, touch, display, kgui, radio, net,
ledmgr, console, testdot (see 1.2). Assert/panic sites: only those found while reading are cited; a full sweep
of `Q_ASSERT`/`KODE_ASSERT` per AO is task T1.

### 3.1 Minimal ordered list of fake areas to reach lock screen and app list
1. system: time, restart, reset reason, keep; 2. display framebuffer + frame-present signal; 3. buttons;
4. ioexp; 5. nvs (persistent); 6. storage/FAT tree with factory content; 7. apps region read side
(`kdrv_apps` list/directory); 8. power reading (static values); 9. touch; 10. radio/net "off".
### 3.2 Next list for Settings to be usable
backlight/brightness, haptic/audio no-ops that report success, time/date set, battery details, storage info
(free space), apps delete/install (write side of `kdrv_apps`), nvs writes verified across reload, BT/Wi-Fi pages
showing "off", IMU stub (stable values).

## 4. Storage content at factory

- `KOS/storage_image/README.md` and `KOS/apps_image/{README.md,welcome.pin}`: the factory FAT contents and the
  apps region (the welcome app is named by `WELCOME_APP "onboarding"`). `tools/mkapps.py` builds the region.
- Web: ship a `factory.json` (file tree plus list of bundles) generated at build time by a script that mirrors
  mkapps/kappdata, apply it once (flag in IndexedDB), then through path (b) of 2.2. **[unverified]** exact
  file list of `storage_image/` (only the README was read).

## 5. Console and station link

- Console commands: **[doc]** the command-set page (truncated at ~100 KB of 104 KB; the Gotchas section was not read).
  In code the console interface is `SDK/components/khal/console/include/khal_console.h`, and the foundation fake
  (`runtime/drivers/console`) already wires it to the page's console panel, so kodeOS's console AO gets the same
  line transport as an app.
- "Station" means the E5 factory fixture, not the user's computer (confirmed in code and docs).
- The computer link (kcli) uses the console for the appdata put flow (`KOS/tools/kcli.py`). For web, the install
  commands should be handled by the page directly (path (b)) and optionally by the real console commands.

## 6. Build plan: "stage 1b, kodeOS boots in the browser"

Task ownership: each task owns distinct files so engineers do not collide.

- **T0 Probe (owner: build tool).** Add `dotbench build --profile kodeos` skeleton; try compiling kgui+LVGL
  against c9568a3 natively (host sim) to find API gaps from the 0910112 gap. Output: list of failures.
  Acceptance (Node): `node tests/kodeos/probe.mjs` exits 0 and prints the failure list.
- **T1 Assert census (owner: docs).** Sweep AO sources for asserts reachable with absent peripherals; output into
  docs only.
- **T2 Toolchain extras (owner: tools/).** em++ for ThorVG, vendored cJSON, inflater (1.8). Acceptance: a Node
  test loads the resulting wasm and calls inflate on a known vector.
- **T3 Flash model and page bootloader (owner: web/ts).** Sector store + IndexedDB persistence (fake-indexeddb in
  Node), `try_boot_requested_app` port, directory read/write code compatible with `mkapps.py` output.
  Acceptance: golden test: region image from `mkapps.py` parses; a TS-built region image is accepted by
  the C parser compiled natively.
- **T4 kdrv_apps/slot/image_check fakes (owner: runtime/drivers/apps).** Section 2.3.
  Acceptance: native C test over a RAM flash; then a wasm run listing N entries.
- **T5 system, keep, nvs persistence (owner: runtime/drivers/system, nvs).**
  Acceptance: write nvs, restart, read back (Node harness doing a restart loop).
- **T6 storage/FAT tree and factory content (owner: runtime/drivers/storage + tools/factory).**
  Acceptance: Node lists `/storage/.kode/appsdata/*`.
- **T7 Display/touch/buttons for LVGL (owner: runtime/drivers/display, input).** Reuse the foundation's
  framebuffer.
- **T8 Peripheral benign fakes (owner: runtime/drivers/misc).** Order in 3.1/3.2.
- **T9 Integration (owner: tests/kodeos).** Node acceptance, in order:
  1. boot to lock screen: framebuffer non-trivial (e.g. more than N distinct colors) and stable across two
     frames 500 ms apart, plus the expected log line;
  2. unlock via button/touch events;
  3. app list shows N entries (N from factory.json);
  4. launch app X (request written, worker group torn down, app bundle logs its boot line);
  5. return to OS (BOT hold 3000 ms or `kode_sys_exit_to_os`) and lock/app list reappear with FROM_APP reason.
- **T10 Console install path (owner: web/ts console).** Install a `.dotbench` through the console path and see it listed.

Parallelism: T0, T1, T2, T3 can start together; T4 depends on T3's format code; T5-T8 are independent; T9 last.

## 7. Risks and unknowns

- R1 SDK commit gap (0910112 vs c9568a3): possible compile or API breaks; mitigation T0, or fetch the pinned
  commit (needs network, not available in the shallow clone).
- R2 ThorVG C++ under Emscripten pthreads: build time, code size, stack use (the code notes deep stacks in LVGL's
  thread; `kody_start` comments).
- R3 cJSON and zlib sourcing (1.8).
- R4 Memory/worker budget: kodeOS has many AOs (one pthread each) plus LVGL; browsers limit threads and wasm memory.
- R5 Fatal paths in AOs not read (audio, imu, haptic, nfc, radio, touch, display, ledmgr); unknown whether kgui
  asserts without a power reading.
- R6 The foundation stubs in kdrv_apps/slot/image_check/kfw and missing headers (esp_partition etc.) may need
  edits in files owned by the foundation engineer; coordinate or add new files and a source-list switch.
- R7 Doc/code mismatches already found: home hold (docs 600 ms vs code 3000 ms), icon size; code wins.
- R8 Timing: kodeOS uses 33 ms LVGL refresh and Lottie animations; the pthread shim's timing may starve the GUI.

Files read and still unverified are flagged inline with **[unverified]**.
