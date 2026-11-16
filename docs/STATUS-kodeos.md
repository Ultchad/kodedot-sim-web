# STATUS: kodeOS in dotbench (stage 1b, build and first boot)

Branch `area/kodeos`, worktree `/home/claude/wt/kodeos`. kodeOS 7612a16 (`/home/claude/src/KodeOS`) against kode-sdk
c9568a3, LVGL 9.6.0, Emscripten 7.0.0.

**Reached: goals 1, 2, 3 and 4.** kodeOS compiles, links with zero undefined symbols, boots under Node, draws its lock
screen (the face: clock, "Choose your time zone" pill, Kody animated by ThorVG/Lottie from the pack), a swipe opens the
launcher, which shows its empty state ("No apps yet"). No assert, panic, hang or restart on the way.

    tools/dotbench build /home/claude/src/KodeOS --role kodeos       # -> <build>/apps/kodeos/kodeos.dotbench
    tests/node/kodeos/run.sh                                         # builds it, runs tests/node/kodeos/*.kodeos-test.mjs
    node tests/node/kodeos/probe.mjs 15 /tmp/shot.png                # developer probe: boot, print the log, save a PNG
    PROBE_ACTIONS="wait:4000,touch:360:300:1,wait:40,touch:40:300:1,wait:40,touch:40:300:0,wait:2500,shot:/tmp/a.png" node tests/node/kodeos/probe.mjs 10

## SDK compatibility (c9568a3 vs the 0910112 that kodeOS pins)

`git -C kode-sdk log 0910112..c9568a3` = 3 commits (a5195f1, 3ad18b1, c9568a3); the diff touches 55 files. **Two source
incompatibilities** broke kgui's compile; everything else, including all runtime behaviour reached so far, is compatible:

1. `storage_write_all_request()` gained a 5th argument `tag` (a5195f1). kgui_assets.c:747 calls it with 4.
2. `KFAIL_KEEP` was removed from the install-failure enum and `KFAIL_BUSY` added with a different meaning (a5195f1);
   kgui_ao.c:21863 reads `KFAIL_KEEP` to pick a sentence for the failure sheet.

Worked around without touching either tree: `tools/profiles/kodeos_compat.h` is force-included into kgui's sources only
(`storage_write_all_request` gets `KODE_STORAGE_TAG_NONE`, `KFAIL_KEEP` maps to `KFAIL_BUSY`; the failure sheet would show
the old "card could not keep" sentence for a BUSY refusal, cosmetic). kodeOS needs a real fix when its pin moves.

## Build profile

Additive: `--role kodeos` on `sdk` and `build` (default role `app` is untouched; `build/` of the app role is
byte-identical: verified by running `dotbench sdk` on a seeded dir, 0 files compiled, and `tests/node/run.sh` green).

| piece | where |
|---|---|
| OS-role library set | `<build>/kodeos/` (own `sdkconfig.h`, `obj/`, `lib/`, `stubs/`, `gen/`); the app role's `<build>/lib` is not touched |
| sdkconfig | `kbsp/sdkconfig.board` + KodeOS `sdkconfig.defaults` + `tools/profiles/sdkconfig.web.kodeos.defaults` + area `sdkconfig` keys; kgui's `Kconfig` is read too |
| extra SDK sources | `tools/dblib/kodeos.py`: `kaos/test_dot`, `kui/test_dot`, `kui/pack/kui_pack.c` (real now, with cJSON) |
| ThorVG | `em++ -std=gnu++17 -fno-exceptions -fno-rtti`, `kui_tvg_config.h` force-included as kui's CMake does (no ThorVG threads, no SVG loader); 47 files in `libdotbench_lvgl.a`; link with `em++` (libc++) and `-pthread` |
| cJSON | `third_party/cJSON` v1.7.19 (tag, commit c859b25da02955fef659d658b8f324b5cde87be3; also what the SDK's idf_component.yml asks), MIT licence kept, files unmodified |
| inflate | LVGL's bundled lodepng (`CONFIG_LV_USE_LODEPNG=y` in the profile), wrapped in `runtime/drivers/kodeos_boot/zlib_lodepng.c` as `khal_zlib_decompress` |
| kgui + main | `components/kgui/CMakeLists.txt` is parsed for its source list (102 files with main); compiled like an app |
| assets | kgui's fonts and glyphs are C arrays, compiled with it. The FAT content (Kody's pack `kode/*.json.z`, 324 KB) is staged as kodeOS's CMake does and is (a) packaged as `factory/storage/**` plus `manifest.factory` in the `.dotbench`, and (b) embedded in the wasm (`gen/kodeos_factory.c`) for the stand-in FAT |
| link | `-Wl,--wrap=kdrv_display_link` (see stand-ins), `-Wl,-Map` (always, feeds `tools/stubs_report.py`) |
| areas | new manifest key `"roles"` (default both); `kodeos_boot` is `["kodeos"]` so nothing of it reaches an app build |

Numbers (this 2-core machine, load average 15-50 from other engineers, so wall times are inflated):

| | |
|---|---|
| `kodeos.wasm` | 2.77 MB (display_lvgl: about 0.38 MB package); `kodeos.dotbench` 1.46 MB (with the 324 KB pack) |
| SDK/LVGL/ThorVG/runtime from scratch for the OS role | about 4 to 5 min (333 SDK + 324 LVGL incl. 47 C++ + 23 runtime files) |
| kgui + main (102 files) | about 1 min; relink + package 35 to 40 s; incremental no-change `build` 8 s |
| app role cost of the new code | none: same flags, same objects (no recompile on a seeded dir) |
| wasm memory | `-sINITIAL_MEMORY=96MB` (same as apps; the adapter assumes a fixed size). Also boots, locks and swipes at 64 MB; not measured below |
| threads | 35 pthreads running at the lock screen, 13 idle in the pool; `-sPTHREAD_POOL_SIZE=48` (apps: 32, which kodeOS exceeds) |
| stacks | main `-sSTACK_SIZE=1MB`, default pthread 256 KB (the RTOS layer gives each task max(4 x depth, 64 KB)); LVGL + ThorVG + Lottie rendering ran without overflow in the GUI task |
| first frame | 160 to 240 ms after `app_main` (kgui's own log line) |

## Deviations from kodeOS's real configuration

- Forced config (profile, relative to KodeOS `sdkconfig.defaults`): the web block of `runtime/idf/sdkconfig.web.defaults`
  minus its app-role lines (`BOOT_ROLE_APP`, `CONSOLE`, `RADIO=n`, `ESP_HOSTED_ENABLED=n`, `BT_ENABLED=n`), so kodeOS keeps
  BOOT_ROLE_OS, RADIO, BLE, WIFI, NET, NFC, MIRROR, SCHEDULER, LOWPOWER, TEST_DOT, THORVG, LOTTIE, SNAPSHOT. Plus
  `LV_OS_NONE`, 1 draw unit, every Montserrat size (as for apps) and **`LV_USE_LODEPNG=y`** (new; inflate). The
  `COMPILER_OPTIMIZATION_SIZE`, coredump, TinyUSB, camera and PM options are read but have no effect here (all code -O2).
- Source files not compiled in the OS role, on top of the app role's list (all become generated stubs, declared in
  `runtime/drivers/kodeos_boot/area.json` with the reason): `kdrv_compose.c`, `kdrv_jpeg.c`, `kdrv_ppa.c`,
  `kdrv_radio.c`, `kdrv_radio_rpc.c`, `kdrv_c5.c`, `kdrv_wifi.c`, `kdrv_net.c`, `kdrv_ble.c`, `kdrv_ov5640.c`,
  `kdrv_station_i2c.c`, `kdrv_dock_loop.c` (each needs ESP-IDF headers that do not exist here: `esp_event.h`,
  `esp_hosted.h`, `driver/ppa.h`, `driver/gpio.h`...). The rest of `kdrv/radio` (sleep policy, notes, frames, ble_*) and the
  whole of `kaos/radio`, `kaos/net`, `kaos/nfc` compile and run on the stubs. The RFAL sources of `kdrv/nfc` are not compiled
  (as for apps; the `kdrv_st25r3916` file is superseded by the nfc area).
- `components/kui/pack/src/kui_pack.c` is un-superseded for the OS role (the platform area supersedes it for apps).
- `khal_zlib_esp.c` stays superseded (platform area); the function is provided by `kodeos_boot/zlib_lodepng.c`.
- Assets not generated: `storage_image/c5_slave.bin` (needs `tools/build_c5.sh`, ESP-IDF 6.1 for the C5) and
  `.kode/appsdata/onboarding/` plus `apps_image/onboarding.bin` (`tools/build_welcome.sh` clones a private repository).
  Hence the FAT has no appsdata and the apps region no welcome app. Nothing in the boot reads them.
- `kodeos_boot/internal_stubs.c`: six hand-written stubs for functions the generator cannot see (not in a public header).

## Stubbed functions kodeOS references that the two examples do not (work list)

From the linker map: functions of generated stubs (`tools/stubs_report.py kodeos.map --minus buttons_led.map --minus display_lvgl.map`),
240 in 20 groups, retained by the linker, so reachable by static references. Ordered by when they matter:

1. **Apps region and OS update (boot decides on them; list stays empty):** kdrv_apps (23), kdrv_slot (7), kdrv_kfw (12), kdrv_image_check (4).
   Log: `kaos.boot apps region unreadable; boot reason may read cold`, `a kodeOS update never confirmed; staying on factory`.
2. **Power:** khal_power (12) (`kaos.lowpower power management did not start; the board stays AWAKE`: no sleep, no off) and the
   PMIC/gauge I2C chips (`kdrv.bq25896 no ACK at 0x6B`, `kdrv.cw2217 no ACK at 0x64`: no battery reading, no charge state).
3. **Radio, which also feeds IR and BLE console:** kdrv_radio (17), kdrv_c5 (13), kdrv_wifi (13), kdrv_ble (34), kdrv_net (33);
   `kdrv.ir no peer-data slot` (IR AO fails because kdrv_radio_peer_listen/send are stubs). Wi-Fi/Bluetooth pages and the
   time sync have nothing to talk to.
4. **Display extras:** kdrv_display (3: band, gram_write, reset_low: the glass-recovery path), kdrv_jpeg (3), kdrv_ppa (2).
5. **Sensors and actuators:** audio kdrv_es8311 (17), NFC kdrv_st25r3916 (19), RFID kdrv_rfid_lf (3), IMU QMI8658/QMC5883P and
   haptic AW86233 (I2C chips absent: `no ACK`).
6. **Storage:** khal_sdmmc (12) (no card; `/sdcard/.kode/launcher.keep` cannot be opened: harmless) and the FAT (stand-in below).
7. **Factory fixture only (E5 test):** kdrv_ov5640 (6), kdrv_dock_loop (1), internal_stubs (6).

Full list by group:

- `internal_stubs` (6): bus_inform_slave_host_power_save_start, bus_inform_slave_host_power_save_stop, kdrv_ble_app_host_bytes, kdrv_station_i2c_probe, kdrv_station_i2c_write, kdrv_station_i2c_write_read
- `kdrv_apps` (23): kdrv_apps_build_id, kdrv_apps_desc, kdrv_apps_dir, kdrv_apps_dir_commit, kdrv_apps_erase_header, kdrv_apps_extent_crc, kdrv_apps_init, kdrv_apps_pending_consume, kdrv_apps_pending_os_intent, kdrv_apps_pending_present, kdrv_apps_pending_read, kdrv_apps_pending_sink, kdrv_apps_pending_verify, kdrv_apps_plan, kdrv_apps_present, kdrv_apps_read, kdrv_apps_region_size, kdrv_apps_req_armed, kdrv_apps_req_clear, kdrv_apps_req_present, kdrv_apps_req_tried, kdrv_apps_sink, kdrv_apps_write_reached
- `kdrv_ble` (34): kdrv_ble_activity, kdrv_ble_addr, kdrv_ble_adv_calm, kdrv_ble_app_declared, kdrv_ble_app_kick, kdrv_ble_battery_declared, kdrv_ble_battery_set, kdrv_ble_bonds, kdrv_ble_conn_calm, kdrv_ble_console_attached, kdrv_ble_console_backlog, kdrv_ble_console_raw, kdrv_ble_console_retry, kdrv_ble_console_selftest, kdrv_ble_console_set_raw_cb, kdrv_ble_console_set_rx_cb, kdrv_ble_console_set_sent_cb, kdrv_ble_console_tx_drop, kdrv_ble_console_write, kdrv_ble_console_write_confirmed, kdrv_ble_link_secure, kdrv_ble_links, kdrv_ble_mirror_attached, kdrv_ble_mirror_write, kdrv_ble_name, kdrv_ble_pair_reject, kdrv_ble_pair_take, kdrv_ble_scan_abort, kdrv_ble_scan_count, kdrv_ble_scan_get, kdrv_ble_set_cb, kdrv_ble_set_hear_cb, kdrv_ble_set_pair_cb, kdrv_ble_state
- `kdrv_c5` (13): kdrv_c5_app_version, kdrv_c5_build_date, kdrv_c5_build_time, kdrv_c5_dump, kdrv_c5_elf_sha, kdrv_c5_field_by_name, kdrv_c5_field_info, kdrv_c5_get, kdrv_c5_idf_ver, kdrv_c5_mac, kdrv_c5_project_name, kdrv_c5_set, kdrv_c5_target
- `kdrv_display` (3): kdrv_display_band, kdrv_display_gram_write, kdrv_display_reset_low
- `kdrv_dock_loop` (1): kdrv_dock_loop_run
- `kdrv_es8311` (17): kdrv_es8311_apply_settings, kdrv_es8311_buf, kdrv_es8311_buf_file, kdrv_es8311_hush, kdrv_es8311_info, kdrv_es8311_init, kdrv_es8311_is_open, kdrv_es8311_present, kdrv_es8311_record_end, kdrv_es8311_record_reset, kdrv_es8311_reg_read, kdrv_es8311_reg_write, kdrv_es8311_result, kdrv_es8311_run, kdrv_es8311_stream_end, kdrv_es8311_stream_idle_ms, kdrv_es8311_stream_reset
- `kdrv_image_check` (4): kdrv_image_check_abort, kdrv_image_check_begin, kdrv_image_check_end, kdrv_image_check_feed
- `kdrv_jpeg` (3): kdrv_jpeg_encode, kdrv_jpeg_init, kdrv_jpeg_selftest
- `kdrv_kfw` (12): kfw_abort_owned, kfw_appdata_release, kfw_appdata_take, kfw_begin, kfw_buf_sink, kfw_end, kfw_feed, kfw_foreign, kfw_hdr_parse, kfw_malformed, kfw_produced, kfw_sha256
- `kdrv_net` (33): kdrv_net_http_body, kdrv_net_http_forget, kdrv_net_http_get, kdrv_net_http_get_range, kdrv_net_http_post, kdrv_net_http_post_body, kdrv_net_http_put_prepare, kdrv_net_http_result, kdrv_net_info, kdrv_net_lookup, kdrv_net_mqtt_publish, kdrv_net_mqtt_publish_acked, kdrv_net_mqtt_rx_dropped, kdrv_net_mqtt_rx_owe, kdrv_net_mqtt_rx_take, kdrv_net_mqtt_session, kdrv_net_mqtt_set_cb, kdrv_net_mqtt_state, kdrv_net_mqtt_subscribe, kdrv_net_mqtt_unsubscribe, kdrv_net_mqtt_uri_copy, kdrv_net_ping, kdrv_net_ping_count, kdrv_net_ping_get, kdrv_net_ping_stats, kdrv_net_run, kdrv_net_sntp_start, kdrv_net_sntp_sync_now, kdrv_net_stream_close, kdrv_net_stream_open, kdrv_net_stream_read, kdrv_net_udp_send, kdrv_net_udp_sent
- `kdrv_ov5640` (6): kdrv_ov5640_apply, kdrv_ov5640_close, kdrv_ov5640_grab, kdrv_ov5640_open, kdrv_ov5640_probe, kdrv_ov5640_release
- `kdrv_ppa` (2): kdrv_ppa_init, kdrv_ppa_prepare
- `kdrv_radio` (17): kdrv_radio_adopted, kdrv_radio_c5_held, kdrv_radio_c5_hold, kdrv_radio_exp_level, kdrv_radio_exp_switched, kdrv_radio_exp_wish, kdrv_radio_fwversion, kdrv_radio_gate, kdrv_radio_image_header_ok, kdrv_radio_link_up, kdrv_radio_note_leave, kdrv_radio_note_update_waits, kdrv_radio_on_link_lost, kdrv_radio_peer_listen, kdrv_radio_peer_send, kdrv_radio_probe_result, kdrv_radio_run
- `kdrv_rfid_lf` (3): kdrv_rfid_lf_rest, kdrv_rfid_lf_run, kdrv_rfid_lf_set_worker_check
- `kdrv_slot` (7): kdrv_otadata_clear, kdrv_slot_confirm_self, kdrv_slot_crashes, kdrv_slot_crashes_set, kdrv_slot_reject_self, kdrv_slot_sink, kdrv_slot_state
- `kdrv_st25r3916` (19): kdrv_st25r3916_activated, kdrv_st25r3916_active_tag, kdrv_st25r3916_apdu, kdrv_st25r3916_discover_start, kdrv_st25r3916_emulate_snapshot, kdrv_st25r3916_emulate_start, kdrv_st25r3916_emulate_stop, kdrv_st25r3916_field_info, kdrv_st25r3916_field_off, kdrv_st25r3916_identity, kdrv_st25r3916_init, kdrv_st25r3916_listen_begin, kdrv_st25r3916_listen_end, kdrv_st25r3916_listen_step, kdrv_st25r3916_reselect, kdrv_st25r3916_t2t_read, kdrv_st25r3916_t2t_write, kdrv_st25r3916_transceive_bits, kdrv_st25r3916_worker
- `kdrv_wifi` (13): kdrv_wifi_channel_last, kdrv_wifi_fail_last, kdrv_wifi_keep_station_on_restart, kdrv_wifi_on_lost, kdrv_wifi_rssi_last, kdrv_wifi_scan_abort, kdrv_wifi_scan_count, kdrv_wifi_scan_get, kdrv_wifi_scan_next, kdrv_wifi_scan_progress, kdrv_wifi_ssid_copy, kdrv_wifi_started, kdrv_wifi_state
- `khal_power` (12): khal_power_hold, khal_power_holds_release, khal_power_init, khal_power_lock, khal_power_lock_new, khal_power_off_enter, khal_power_off_note, khal_power_off_note_set, khal_power_stats, khal_power_wake_arm, khal_power_wake_rearm, khal_power_woke_from_off
- `khal_sdmmc` (12): khal_sdmmc_cluster_bytes, khal_sdmmc_format, khal_sdmmc_hosted, khal_sdmmc_info, khal_sdmmc_mount, khal_sdmmc_mount_point, khal_sdmmc_mounted, khal_sdmmc_read_sectors, khal_sdmmc_ready, khal_sdmmc_set_hosted, khal_sdmmc_unmount, khal_sdmmc_write_sectors

## First boot: every problem found, classified

No assert, panic or hang occurred. What did go wrong, in the order met:

| # | symptom | cause (source) | class | resolution |
|---|---|---|---|---|
| 1 | `Choose your time zone`; face has no Kody, log `an animation's 4334 bytes do not inflate to its 25480 (status 1)` | `khal_zlib_decompress` was a stub (kui_kody.c:294, kgui_assets.c:838) | (a)/(b) | `kodeos_boot/zlib_lodepng.c`, LVGL's lodepng; tested by the Kody scenes now drawing |
| 2 | after about 10 s `kaos.display the glass is lost (frames 3, dpi 0): restart 1 of 3`, panel reset; after 3 restarts `power_ship_request()` on battery | `display_ao.c:1679-1699`: with video expected, `kdrv_display_link().frames` must advance between 100 ms looks. The display fake reports `frame_seq`, which counts flushes, so a still screen stops it | (c) timing/semantics | `kodeos_boot/display_link.c`, linker `--wrap` giving a 60 Hz counter. Owner of `runtime/drivers/display` should do this in `kdrv_display_link()` and delete the wrap |
| 3 | pack not found: `kgui assets: source=builtin name=-` | `kdrv_fs_mount` stub: no `/storage` | (a) | `kodeos_boot/storage_memfs.c`: Emscripten MEMFS filled from the embedded factory tree (`source=fat name="Kody" version="2026.11.05.2" scenes=10`) |
| 4 | link: 8 undefined symbols | functions of superseded kdrv files not in a public header | (b) | `kodeos_boot/internal_stubs.c` |
| 5 | kgui does not compile | 2 SDK API changes between 0910112 and c9568a3 | SDK gap | `tools/profiles/kodeos_compat.h` |
| 6 | `LV_USE_MATRIX must be enabled` | `gen_sdkconfig.py` resolved `select` chains one level only (LOTTIE -> VECTOR_GRAPHIC -> MATRIX) | (b) | fixpoint in `tools/gen_sdkconfig.py`; app-role `sdkconfig.h`/`.json` verified byte-identical |
| 7 | ThorVG `tvgCompressor.cpp: use of undeclared identifier 'free'` | on IDF `<stdlib.h>` arrives through another header | (b) | `-include stdlib.h` for the C++ files (same trick as `-include stdio.h` for C) |

Behaviour that is not a bug but explains the screens: with no stored time zone the top button on the face opens the Time
page ("the yellow pill asks for the zone", shot 04); unlock is a horizontal
drag on the face (a swipe up on the face does nothing, a swipe down pulls Settings; `kgui_ao.c` `gui_gesture_zone`).

## Temporary stand-ins (all in `runtime/drivers/kodeos_boot/`, role kodeos only)

| file | what | who replaces it |
|---|---|---|
| `storage_memfs.c` + `kodeos_factory.h` + generated `gen/kodeos_factory.c` | `kdrv_fs_*` over Emscripten MEMFS at `/storage`, filled from the staged factory tree on every boot (not persistent, capacity only reported: 2016 KB) | storage engineer (FAT + factory content applied once, persisted) |
| `display_link.c` | `__wrap_kdrv_display_link`: frames = 60 Hz refresh counter | display area owner |
| `zlib_lodepng.c` | real `khal_zlib_decompress` on lodepng (lenient about trailing bytes) | platform area; delete when theirs exists |
| `internal_stubs.c` | 6 unlisted functions of superseded files | radio engineer (3), exp/station engineer (3) |
| `area.json` `supersedes` | 12 kdrv files turned into generated stubs | radio, display/compose, mirror, exp engineers: when one lands its fake, the build errors with "superseded by both" and its entry here must be removed |

## Shared-file edits

None under `runtime/web-adapter`, `runtime/bridge`, `runtime/rtos`, `web/`, or in another area. Changes under `tools/`
(allowed, additive): `tools/dotbench` (role plumbing, `--role`, `--kodeos`, `--map`, `--memory-mb`/`--pool` now default
per role; app defaults unchanged at 96 / 32), `tools/dblib/areas.py` (`roles`, `load_areas(root, role="app")`),
`tools/dblib/toolchain.py` (`em++` for `.cpp` in `compile_one`), `tools/gen_sdkconfig.py` (select fixpoint),
new `tools/dblib/kodeos.py`, `tools/profiles/*`, `tools/stubs_report.py`.

`tests/node/run.sh` is NOT edited. It maps every `tests/node/<dir>` that holds `*.test.mjs` to `runtime/drivers/<dir>/area.json`
and exits 2 when that does not exist; `tests/node/kodeos` would break it (the stand-ins live in `kodeos_boot`). So the test is
named `boot.kodeos-test.mjs` and run by `tests/node/kodeos/run.sh`. Coordinator: either keep it so, or rename the area folder
to `runtime/drivers/kodeos` and the test to `*.test.mjs`, plus `run.sh` must build `--role kodeos` (the test needs
`$DOTBENCH_BUILD/apps/kodeos/kodeos.dotbench`).

## Screenshots (`docs/kodeos-shots/`, each looked at with the Read tool)

- `01-face-first-boot-no-kody.png`: first boot with the stubs: the lock screen (clock 19:50, orange "Choose your time zone" pill), Kody absent (zlib stub).
- `02-lock-screen-kody.png`: after zlib + FAT stand-in: sunrise scene, Kody (blue) with ThorVG/Lottie animation, shelf band at the bottom.
- `03-unlocked-empty-app-list.png`: after a swipe: launcher with "No apps yet / Tap Kody to find apps", Kody asking.
- `04-time-page-top-button-no-zone.png`: the top button on the face with no time zone stored: Time settings page (Time zone UTC, Hour, Minute, Day).

## Verification (final passing output)

```
$ DOTBENCH_BUILD=/tmp/kos-build tests/node/kodeos/run.sh
== dotbench build /home/claude/src/KodeOS --role kodeos
dotbench build: /tmp/kos-build/apps/kodeos/kodeos.dotbench (1456540 bytes)
== tests/node/kodeos/boot.kodeos-test.mjs (Node)
ok   - boots, the real AOs come up and the first frame is drawn
ok   - Kody's pack is read from the FAT stand-in and inflated (no 'do not inflate' warning)
ok   - lock screen: a non-trivial framebuffer (clock, pill, Kody)
ok   - lock screen is stable: the clock band never changes, the glass is never declared lost, frames keep coming
ok   - a swipe left on the face opens the launcher: empty state, no apps
kodeos: PASSED
KODEOS TESTS PASSED

$ DOTBENCH_BUILD=/tmp/kos-build tests/node/run.sh      # existing suites, with the new tools
85 checks, 0 failed / buttons_led: PASSED / display_lvgl: PASSED / restart: PASSED / ALL TESTS PASSED
```

## Top risks

1. **Real browser not tried** (Node only). New in the browser: 35 worker threads (Safari/iOS limits), FS calls from AO threads are
   proxied to the page's main thread (MEMFS under PROXY_TO_PTHREAD), so the page must keep its loop free; the adapter assumes 96 MB.
2. **Timing under load**: kgui ticks at 33 ms and Lottie runs in the GUI task; the test tolerates a minute rollover of the clock
   band but a starved machine could miss the 60 s first-frame wait. Re-run before concluding.
3. **Persistence**: the time zone and every setting live in the `nvs` persist region (page session only); the FAT stand-in is
   rebuilt each boot, so apps data and the Kody pack updates are lost.
4. **Boot model**: kodeOS decides what to run from the apps region (`kdrv_apps_*`, 23 stubs). With the stubs, "boot reason may read cold".
   Whoever builds it must also provide `kdrv_slot_*` or kodeOS keeps saying "a kodeOS update never confirmed".
5. **SDK pin**: two compat shims (see above) hide real API changes; a third commit of the SDK may break kgui again.
6. **Display link counter** is a wrap-based stand-in; if the display owner changes `kdrv_display_link` semantics both ends must change together.
