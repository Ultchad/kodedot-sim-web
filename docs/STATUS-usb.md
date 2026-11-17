# STATUS: USB (area/usb)

Branch `area/usb` (worktree /home/claude/wt/usb, from main 8693d2c). Written in two halves: section 1 (findings from the code, written before building) and the later sections (what was built, tests, API).

## 1. What the USB-C port really does (findings, from the code)

Paths: `SDK` = /home/claude/src/kode-sdk (c9568a3), `KOS` = /home/claude/src/KodeOS.

**The port is a USB-Serial/JTAG device plus a power input. Nothing else.** There is no USB host, no HID, no mass storage, no MTP/DFU and no vendor protocol in the SDK or in kodeOS.

| Function of the cable | Where (code) | Reachable by |
|---|---|---|
| VBUS / charger detection (BQ25896 input detection: none, SDP host 500 mA, adapter 3.25 A). The only USB fact in the public API: `kode_power_is_usb_connected()` (SDK `components/kode/include/kode.h:1603`, impl `kode/src/kode_battery.c:289`, "judged from the last battery reading"), `kode_sys_battery_t.vbus`, `PowerEvt.vbus`/`vbus_mv`. | `kdrv/power/include/kdrv_bq25896.h:122` (`KDRV_BQ_VBUS_SDP`), `kaos/power/src/power_ao.c` | apps (read) and kodeOS |
| Rules that depend on VBUS: `kode_power_off()` refused ("the board cannot switch off while USB is plugged in", `kode_battery.c:265`), 5 V boost refused (`kode_battery.c:356`, `power_ao.c:1852`), sleep/off refused (`kode_sys.h:480-502`), wake from sleep by plugging (`kaos.h:2032`, `KODE_LP_CAUSE_VBUS` `kqp_signals.h:7379`), ship mode only without USB. | power AO, lowpower AO | apps and kodeOS |
| **Console over the cable**: the cable is the console port, `CONFIG_ESP_CONSOLE_USB_SERIAL_JTAG`. `khal_console_*` (`khal/console/include/khal_console.h`, `khal/console/src/khal_console_esp.c`): a reader task blocks on `usb_serial_jtag_read_bytes` (driver RX ring 8192 B; the hardware ISR drops silently when it is full, `kqp_config.h:1862`, `kqp_signals.h:77`), writes go out in 128 B chunks with a 500 ms wait for ring room, then "nobody is reading": later chunks are dropped until one fits (`cable_put`). Output of `kode_print`/klog reaches it through AO_Log (`kaos/log/src/log_ao.c`, `khal_console_write`), input goes byte by byte to AO_Log's line editor, which hands whole lines to the console AO (`kaos/console/src/console_ao.c`, verbs table at line 6536). | `khal_console_esp.c`, `log_ao.c`, `console_ao.c` | apps: `kode_print` (output only, `kode.h:123`) and the app's own console verbs (`KODE_FUNCTIONS_ADD`); `kode_sys_console_congested()` (`kode_sys.h:1833`, `log_ao.c:104`). kodeOS: the whole verb set. |
| **Raw mode** on the same wire for payloads: `khal_console_raw_begin(pump, on_armed)`, the reader task drains residue, calls `on_armed`, then runs `pump` (AO_Log's `raw_pump`, `log_ao.c:411`) which reads `size` bytes in 4096 B chunks and posts `RECV_DATA_SIG` to the requester; the count is the boundary, then back to the line editor. Flow control is the `>|ack` after each 4096 B chunk (the wire has none). | `khal_console_esp.c:raw_begin`, `log_ao.c` | kodeOS's AppMgr and Console AO only |
| **The computer link**: `install src="terminal" dst=app|os|c5|pending size=N crc32=C [run=on|off] [name=..]` and `file_put path= size= crc32=` (`console_ao.c:1435-1790`): the board answers `>|ready chunk=4096`, the host sends raw bytes one chunk per `>|ack`, the closing `>ok` arrives only after CRC, decode and commit. Reference client: `KOS/tools/kcli.py` (`stream_payload`, `do_install`, `do_file_put`, `do_appdata_put`). | `console_ao.c`, `appmgr_ao.c` (`APP_RECV_REQ_SIG` line 4046, `AppMgr_receiving`, `recv_close`) | kodeOS (AppMgr is not started by an app) |
| **The mailbox**: partition `app_pending` (0x1A00000, 6 MB on the board; its last 4 KB sector is the OS-intent word). A host tool (`jtag_flash.sh`, esptool, or `install dst=pending` over the console) leaves a bare ESP image or a `KFW1` container there; AppMgr adopts it at boot (`AppMgr_initial` line 3829, `adopt_finish` ~3606) or on `install src="pending" dst=app` (`appmgr_ao.c:4228`). The container: 72-byte header, optional DEFLATE, SHA-256 of the decompressed image, optional `KAD1` block carrying `app.json` and `icon.k64` (`kdrv/apps/include/kdrv_kfw.h`). | `kdrv/apps/src/kdrv_apps.c` (`kdrv_apps_pending_*`), `kdrv_kfw.c` | kodeOS |
| **App data pushed the real way**: `mkdir` x3 + `file_put` of `app.json` and `icon.k64` into `/storage/.kode/appsdata/<project>/` (`kcli.py do_appdata_put`), or the `KAD1` block of a container (AppMgr writes the folder itself). kodeOS lists apps from the directory plus that folder. | `kcli.py:~770`, `kdrv_kfw.h` | kodeOS |
| File transfer: `file_put` (computer to FAT/SD), `file_get` (board to computer, base64 `>\|d=` records), `screenshot` (BMP in records), `write`, `mkdir`, `stat`, `ls`, `cat`, `rm` (console verbs, `console_fs.c`) | `console_ao.c`, `console_fs.c` | kodeOS |
| Screen mirror (`mirror_start`, JPEG frames in `>\|m=` records, `KOS/tools/kmirror.py`) | `kdrv/mirror` (JPEG encoder and PPA hardware) | kodeOS |
| Port-open resets: `KDRV_RESET_USB` ("USB port opened", `kode_sys/src/kode_banner_text.c:36`), `KAPPS_RESET_USB_UART 0x17` is in the closed list of resets that keep an ARMED app request (`kapps_fmt.h:133-160`; bootloader `bootloader_start.c`). `kcli.py` deasserts DTR/RTS before opening so it does not cause one. | boot AO, bootloader | system |
| Dock console: a second console on the magnetic pads (GPIO26/27) as TinyUSB CDC-ACM (`CONFIG_KHAL_CONSOLE_DOCK=y` in `KOS/sdkconfig.defaults:53-60`; `khal_console_esp.c` `dock_*`). Not the USB-C port. | `khal_console_esp.c` | kodeOS (build option) |
| JTAG: OpenOCD over the same port (`KOS/tools/jtag_flash.sh`), reset cause `USB_JTAG`. A development path of the computer, no firmware function. | none | none |

**Confirmed absent (searched `tud_`, `tusb`, `hid`, `keyboard`, `msc`, `mass storage`, `usb host`, `mtp` across `components/`, `examples/`, `KOS/components`, `KOS/main`).** The only TinyUSB use is the dock's CDC-ACM. So:
- *Apps cannot type on a computer.* The store's Scanner "types results over USB" cannot be implemented with this SDK (no HID class, no `kode.h` or `kode_sys.h` function); bench-spec agrees ("No USB data API exists"). Not built.
- *No card reader.* No app or kodeOS exposes the microSD as mass storage; the nearest real things are the console verbs `file_get`/`file_put`/`ls` that reach `/sdcard` over the serial link. The store's "SD Reader" app cannot use USB in this SDK. A "card reader" view is therefore not built; the console file verbs are offered instead.
- *No USB host.* The port never acts as a host; a USB-C instrument app would have to use another interface.

**Which are reachable by apps, which only by kodeOS.** Apps: VBUS (`kode_power_is_usb_connected`, battery events, the refusals above), `kode_print` and app console verbs (`KODE_FUNCTIONS_ADD`), `kode_sys_console_congested`. When an app runs there is no console AO, so `ping`, `install`, `file_put` and the rest of the verb set exist only in kodeOS (kcli's `LINK_HINT` says the same: "a guest app ran ... no console"). kodeOS only: the whole computer link, the mailbox, appdata, file verbs, screenshot, mirror.

**Relation to the page's console.** The foundation's console fake (`runtime/drivers/console/khal_console_web.c`) already stands in for "the cable": it shows every console byte in the page's console panel and accepts typed lines. It is the bench's own debug port: always open, no cable needed. The real device has exactly one USB console (plus the dock), so the bench now has two ports on the same console: the page's debug port (unchanged: always on, sees everything) and the computer's cable port (only while the Computer object is plugged in with its terminal open; this is the port the install protocol uses). Both read into the same reader task, as the cable and the dock do on the board.

### Docs versus code
- bench-spec "USB cable with computer" has `plugged`, `computer attached`, `VBUS voltage`, `console terminal`. The code agrees on plug and console. "VBUS voltage" is not an input of the firmware: the BQ25896 model reports 5000 mV (power area), so it is display-only here.
- bench-spec Open question 1 ("Flashing apps over USB, not emulated"): the SDK has a complete app receive protocol over the console and a mailbox, and the whole point of this area is to emulate it device-faithfully.
- bench-spec says the cable "also attaches the console terminal" when plugged: true for the cable port; the page's debug console stays attached regardless.
- `docs/kodeos-plan.md` section 2 says an app arrives "over the computer link into the mailbox": in code there are two paths, direct (`install src="terminal" dst=app`, no mailbox, AppMgr writes the apps region while receiving) and parked (`dst=pending`, then `src="pending"`, or the boot-time adoption). Both are built here.
- kcli's comments claim opening the port resets the board; the tool itself deasserts DTR/RTS so it does not. Port-open reset is not modelled (see section "not modelled").

## 2. What was built

| Piece | Where | What it is |
|---|---|---|
| Cable pipe and VBUS | `runtime/drivers/usb/usb_cable.c`, `include/usb_cable.h` | State (plugged, host with the port open), the USB-Serial/JTAG data pipe as two rings (RX computer to Dot 8192 B, drops silently when full, as the hardware; TX Dot to computer 64 KB, a chunk goes in whole or not at all, 500 ms wait then the board's "nobody is reading" stall rule). **VBUS is not re-implemented**: `usb_plug` calls the power area's own `power_set_usb` (host: SDP 500 mA; no computer: adapter 3.25 A) so AO_Power notices the cable through the BQ25896 as on the board, charging, the refusals of `kode_power_off`/boost and the `USB plugged in` events all follow from the existing power model. `usb_plug` refuses (-1) when the power area's charger object already holds the connector. |
| Console transport | `runtime/drivers/console/khal_console_web.c` (rewritten, see section 6) | Structured like the real `khal_console_esp.c` (cable + dock): a reader task, line mode over both ports remembering which spoke last, **raw mode with `pump`/`on_armed` run on the reader task and reading only the port that asked**, rest, `raw_begin` denial rules. The old fake never ran the pump, so no payload verb (`install`, `file_put`) could work. Output goes to the page console always and to the cable when a computer is attached. |
| Real container decoder | `runtime/drivers/usb/kfw_deps_web.c`, `include/{psa/crypto.h,esp_app_format.h,miniz.h}`; `runtime/drivers/apps/area.json` (one line removed) | The SDK's own `kdrv_kfw.c` (raw-image and KFW1 container decoding, SHA-256 check, app-data block) is now compiled instead of stubbed. It needs the PSA hash API and tinfl: SHA-256 is a plain C implementation; **tinfl is not modelled** (returns FAILED, so a DEFLATE container is refused as corrupt). 14 stub functions are gone. |
| JS glue | `runtime/drivers/usb/usb.js` | The cable as the computer's side sees it (API below). |
| The computer | `runtime/web-adapter/usb-computer.js` (new file, the only adapter change) | `UsbComputer(sys)`: kcli's protocol over the glue's pipe (line framing, ERASE/ANSI stripping, `>\|` records, `>ok`/`>err`, `ready chunk=N` + stop-and-wait `>\|ack`), `ping`, `cmd`, `file_put`, `file_get`, `appdata put`, `install` direct, `install dst=pending` + `install src=pending dst=app`, a KFW1 container with the KAD1 app-data block, and `flashMailbox` (esptool/JTAG-style: writes `app_pending` with the board off, then the boot-time adoption). Before an image is sent it registers the matching `.dotbench` in the bundle store under the bundle id the KAPD descriptor carries, so after the real AppMgr adopts the image the page's bootloader finds the wasm. It re-plugs the cable after every program start (the physical cable stays in across a reset). Uses `sys.pm`, `sys._run`, `sys._quiesce`, `sys._boot` (private members of `DotbenchSystem`) only in `flashMailbox`; `dotbench-system.js`, `bundles.js`, `kapps.js` are not edited. |

CRC conventions (found by the first failing install): the console protocol's `crc32=` is plain CRC-32 (`zlib.crc32`, `esp_rom_crc32_le(0, ..)` in `khal_crc32`); the container's own header and app-data CRCs are `kfw_crc32` = seed UINT32_MAX (`kapps.js crc32le(0xffffffff, ..)`).

### What the app sees
Nothing new in the API (there is nothing in the SDK to add). With the cable plugged: `kode_power_is_usb_connected()` true after the next battery reading, `PowerEvt.vbus`, charging, `kode_power_off()` refused, boost refused; `kode_print` lines also leave on the cable (kodeOS and apps alike: AO_Log's sink); `kode_sys_console_congested()` follows the same ring logic as before.

## 3. Bench-object API for the page: "Computer on a USB cable"

Device-area glue (`device.area("usb")`, via `DotbenchSystem.area`; recreated at every boot, state in C, **not** kept across a restart, so a driver must re-apply as the power driver does, or use `UsbComputer`, which does it itself):
```
plug(on, {host=true}) -> bool    host=false = plain charger (adapter, no console peer); false = connector taken by the power charger object
setHost(on)                      the computer opens/closes its serial port with the cable in
plugged() host() up()            state
send(bytes|string) -> n          computer -> Dot (8 KB ring)
read() -> Uint8Array             drain Dot -> computer
stats() -> {rxFree, txPending, rxDropped, txDropped, stalled}
on("plug"|"data", cb)            also dev.on("area:usb:plug" / "area:usb:data")
```
System-level (`runtime/web-adapter/usb-computer.js`, `new UsbComputer(sys)`):
```
plug({host}) -> bool, unplug(), plugged, setHost(on)
terminal() -> text, clearTerminal(), type(line), on("text", cb)       the serial terminal
ping(), cmd(line) -> records, command(line) -> {records, term}
filePut(path, bytes), fileGet(path) -> {data}
installPackage(dotbenchBytes, {via:"direct"|"mailbox", run, container, appdata})
flashMailbox(dotbenchBytes)
stream(data, cmd, what, {abortAfter, onAbort, onProgress})          the raw conversation (for error-path demos)
```
Bench fields per bench-spec: `plugged`, `computer attached` (= `host`), `VBUS voltage` (display only: the model reports 5000 mV), `console terminal` (`terminal()`/`type()`).

**What the page should offer.** One object "Computer on a USB cable" (single): plug/unplug, a serial terminal (output + a line input), "Install app" (pick a `.dotbench`; options: run after install, via mailbox), "Send file to the Dot" and "Get file from the Dot" (path fields, `/storage/...` or `/sdcard/...`), a "computer attached" toggle (off = a plain charger). It must not be shown together with the power area's `power.charger` object plugged as `usb` (they share the one connector: `plug()` returns false); the cleanest page rule is that the Computer object owns the "USB port" and the charger object offers only "wall adapter" while a Computer is on the bench. Not to offer: keyboard/typing, card reader, host mode (they do not exist in the SDK).

**The terminal and the page's console.** The page's console panel is the debug port, always open and seeing every console byte (and its typed lines reach the same console AO). The Computer's terminal is the cable port: it exists only while the cable is plugged with a host; it shows the same stream (the Dot writes every console byte to both ports) and the lines typed there are the ones the install protocol uses. Typing in both at once interleaves, as two terminals on one device would.

## 4. Tests

`tests/node/usb/run.sh` (builds kodeOS, power, display_lvgl, buttons_led, kody_kart, then runs both files); `tests/node/run.sh usb` runs `cable.test.mjs` plus the RTOS and acceptance tests.

- `cable.test.mjs`, 8 checks, app role under the unmodified `examples/power`: unplugged start (nothing queued), plug with a computer (the Dot logs `USB plugged in`, cable `usb`, charging), console output reaches the cable and the page, a typed `ping` is echoed and answers `>|pong` `>ok`, connector sharing with the power charger, unplug (VBUS gone, charging stops, rings emptied), plain charger without a computer (VBUS, no console, output discarded), 8 KB RX ring drops what a host sends ahead.
- `install.usb-test.mjs`, 16 checks, kodeOS role in a `DotbenchSystem` (real console AO, AppMgr, kdrv_apps, kdrv_kfw): power-on and plug; ping; verbs and echo over the link (`appdata_ls`); unplug/replug; **direct install** of a `.dotbench`-derived app (listed with name and version, `app.json` and `icon.k64` byte-identical to the package's board data, `appdata_info` shows the name and icon source); **install with run=on** (the page's bootloader starts the bundle); still plugged after the restart; **mailbox path** (`install dst=pending` then `install src="pending" dst=app`); **KFW1 container with the KAD1 block** (AppMgr writes the data folder itself, on the card, verified with `appdata_info medium=sd ... icon status=ok`); `file_put`/`file_get` byte for byte; error paths: junk bytes with a good CRC (refused after the transfer), a size the region cannot hold (`>err` before any byte), wrong CRC, **unplugged mid-transfer** (AppMgr's own idle watchdog: `no data for 5000 ms ... the host is presumed gone`, nothing installed, console back after replug); restart/page reload keeps apps, names and data folders and the cable; `flashMailbox` (boot-time adoption through `AppMgr_initial`).

Final output (this branch, shared 2-core machine):
```
usb cable: PASSED (8 ok, 0 failed)
usb install: PASSED (16 ok, 0 failed)
tests/node/run.sh usb: rtos ALL PASSED; acceptance buttons_led, display_lvgl PASSED; ALL TESTS PASSED
tests/node/kodeos/boot.kodeos-test.mjs (console fake rewrite regression): kodeos: PASSED (13 ok)
```
No browser test was written (the guide does not ask for one for an area; the glue is the same ES module the Node path loads through the package, and `usb-computer.js` uses only `crypto.subtle`, `atob`, `TextDecoder`). Not run in Chrome.

## 5. Assumptions, disagreements, not modelled

- The unplugged-cable case: with no computer the real driver fills its 2 KB TX ring, waits 500 ms once, then drops; here output is discarded at once (no observable difference to the app).
- Port-open reset (`KDRV_RESET_USB`, `USB_UART`) is not modelled: `kcli` itself avoids it, and the system layer has no such restart reason. Consequence: opening the terminal never resets the Dot. A computer program that does assert DTR/RTS would on the board.
- The dock console (magnetic pads, TinyUSB CDC) is not modelled: `khal_console_dock_release/take` return OK. It is the charging base, not the USB-C port.
- DEFLATE containers are refused (tinfl not modelled); bare images and uncompressed containers install. `kdrv_image_check.c` (the file install from SD or FAT) stays stubbed (apps area).
- Screen mirror (`mirror_start`, JPEG/PPA hardware) and `screenshot` over the link were not exercised or built (JPEG encoder is a stub owned by `kodeos_boot`; "mirror/console").
- JTAG/OpenOCD: no firmware function; only its mailbox write is modelled (`flashMailbox`).
- `os` and `c5` install destinations (OTA slot, coprocessor image) are not modelled (`kdrv_slot` stubbed, no C5 firmware): AppMgr refuses them, as it does without the slot.
- Mailbox size is 1 MiB here (6 MB on the board), apps region 0x410000 (board's 0xBC0000): "too large" is judged against the bench's sizes. The synthesised images are 432 B (no machine code), so "too large" is tested with a declared size.
- The Dot's idle watchdog for a stalled transfer is 5000 ms (`KODE_RECV_IDLE_MS`), real time: the unplug test waits about 6 s.
- Docs versus code: see section 1.

## 6. Shared-file changes (for the coordinator to accept)

1. `runtime/drivers/console/khal_console_web.c`: rewritten (same file, same `supersedes`, same `kweb_console_input` export). Needed because the old `khal_console_raw_begin` ignored the pump, so `install src="terminal"` and `file_put` could never receive a byte. It now includes `usb_cable.h` (the usb area).
2. `runtime/drivers/apps/area.json`: the `kdrv_kfw.c` line removed from `supersedes` and the description updated, so the real decoder compiles (it is what the real AppMgr feeds every install and every mailbox adoption through).
3. `runtime/web-adapter/usb-computer.js`: new, nothing else in `runtime/web-adapter/` touched. The page imports it.
4. Not done, for the page engineer: a bench kind/driver in `web/src/bench/drivers/` (TS), i18n strings, and the UI. The kind should call `UsbComputer`.

## 7. Risks

- Once, in a run under load 19, the Node process died with an uncaught Emscripten `ExitStatus exit(0)` from a worker during the app start/return sequence (the next two runs were clean). The boot suite's note about worker aborts in Chrome/Node is the likely relative; not reproduced.
- The console fake now wakes every 5 ms (as the board's reader does 200 times a second) when idle: a little CPU on a loaded machine.
- `UsbComputer.flashMailbox` uses private members of `DotbenchSystem`; the factory-reset engineer's edits there could rename them.
