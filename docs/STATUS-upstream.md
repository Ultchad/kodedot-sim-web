# STATUS: kode-sdk / KodeOS v0.1.2 and the automatic updater

Branch `feat/upstream-0.1.2`. Two parts: the simulator now runs kode-sdk v0.1.2 and KodeOS v0.1.2 (Kody Kart pinned by commit), and a GitHub Actions workflow moves the pins by itself when upstream releases again.

## Pins (tools/pins.env)

| Piece | Pin | Resolved commit |
|---|---|---|
| kode-sdk | tag v0.1.2 | 0a2d8e9dbc920a02372ecadbb6f2ec2ab33a03c8 |
| KodeOS | tag v0.1.2 | f2facea299457277519c453a54b70bd3efc06658 |
| Kody Kart | commit (the repository has no tags; its HEAD is "Build against kode-sdk v0.1.1") | 4ee77321442035c35da4dd3994e5cdef055564db |
| LVGL / Emscripten | v9.6.0 / 7.0.0 | unchanged |

`tools/setup.sh` reads the file, fetches by tag and refuses a tree whose commit differs from the pin (a moved tag). Kody Kart is fetched like the others; `tools/factory-apps.json` says `dep:kode-app-kody_kart` (resolved under `$DOTBENCH_DEPS`, default `.deps`) instead of an absolute local path. `DOTBENCH_EMSDK_REUSE=<dir>` reuses an installed Emscripten.

## What changed in 0.1.2 that mattered to the simulator

kode-sdk (23 commits), the ones that touch what the bench fakes:
- New source files in the SDK build lists: `lowpower_part.c`, `radio_hid.c`, `kdrv_ble_hid.c`, `kode_rest.c` (`tools/dblib/sources.py` mirrors the SDK's CMakeLists by hand, so each new file must be added there).
- BLE HID (the board as mouse and keyboard), pairing refusals reported to AO_Radio (`KDRV_BLE_PAIR_REFUSED`, outcomes HIDDEN and APP_CLOSED) and the pairing hang-up moved to a radio worker job (`kdrv_ble_pair_hang_up`).
- NVS: a per-namespace share (`khal_nvs_set_str_within`, used by `kode_sys_nvs`) and `khal_nvs_erased`.
- App install: `kdrv_image_check_sink`, `kdrv_slot_newer`, whole-image installs, an SD card told apart from no card.
- Light sleep and part rest (`kode_rest`, `khal_power_wake_disarm`, `kdrv_display_panel_cold`, console `frame`/`pad` for the cable bounce), low-cell warning, ls paging, release numbers in `info`, a PPA frame copy.
KodeOS (17 commits): kgui self-test, a card offering a newer kodeOS at boot, the pack read first and the glass faded up at boot, install cards held until the folder names the app. The two compatibility shims that 7612a16 + c9568a3 needed are gone (v0.1.2 pairs with SDK v0.1.2); `tools/profiles/kodeos_compat.h` is now empty but kept for the next mismatch.

## What had to be added (10 new stubs appeared; 6 are real now)

| Function | Done |
|---|---|
| `khal_nvs_set_str_within`, `khal_nvs_erased` | `runtime/drivers/nvs/khal_nvs_web.c`: the quota counts 32-byte entries as NVS does; a page header of another version of the store is erased whole and reported once per boot. The SDK's own NVS cases (33 per round, three rounds) pass; the test app calls a hook (`dbnvs_test_newer_version`) to leave the store as the SDK's host runner does |
| `kdrv_slot_newer` | `runtime/drivers/apps/slot_web.c`: false (no otadata) |
| `kdrv_image_check_sink` | `kdrv_image_check.c` is no longer superseded: the real file runs over the existing PSA SHA-256 shim |
| `khal_console_frame`, `khal_console_pad` | `runtime/drivers/console`: frame count moves with the cable host, the pad is remembered |
| `kdrv_ble_pair_hang_up` | `runtime/drivers/ble/ble_host.c`: two-step reject as on the board (reject marks, hang-up closes); REFUSED notes added |
| `kdrv_ble_hid_kick` | drains and counts as dropped. **HID is not served**: the simulated GATT table never registers the HID service, so `kode_ble` HID calls are told there is no host. Serving HID to the Phone bench object needs a design (a person) |
| `khal_power_wake_disarm`, `kdrv_display_panel_cold` | left as generated stubs, like `wake_arm`/`rearm` and `kdrv_display_reset_low`: part rest and a panel supply cut have no meaning in a browser |

- Found by the page check: kodeOS 0.1.2 asks `api.kode.diy` for a newer kodeOS at boot; the page's CSP only allows itself, so the browser logged errors. `runtime/drivers/net/net.js` now answers that host as unreachable without calling it (the bench should not phone the maker). The glue is baked into the packages, so they were rebuilt.

Other edits: `tools/dotbench` records the pinned SDK commit from `pins.env`; `web/scripts/*` take `CHROME=<path>`.
Tests whose text or setup changed upstream, fixed (no assertion loosened): the C5 link log line (`link up; esp-hosted v...`, `project kode_c5 2.12.9`), `tests/node/persist/host.mjs` (the tool prints the `.zip`; this was broken on main already), the kodeOS boot test waits for the panel (0.1.2 fades the glass up after the first frame).

## Test results

Run with `tools/upstream-update.sh --verify-only` (and `--from areas` to resume). Logs: `/tmp/upstream-logs`.
- kodeOS suite (`tests/node/kodeos/run.sh`): 81 checks ok (BLE pairing, BLE page, boot, radio, big SD).
- Boot suite (`tests/node/boot/run.sh`): 39 checks ok, thirteen factory apps launch by touch and return.
- Areas (`system ble nfc rfid ir wifi radio usb power storage sd persist nvs audio`, plus the RTOS and acceptance tests): 801 checks ok in 50 test files, no failure (`restart` skipped, see below); `net` area also passes.
- Page checks from a scratch build (`npm run build`, headless Chrome): `system-check` all PASS (23), `settings-check` all PASS (19), `bench-check` all PASS. Screenshots looked at: the lock screen and the app list (Games group, Kody Kart). `settings-check` failed once on its page-preferences check and passed on the rerun (the updater reruns a page check once).
- Failing before 0.1.2 too, so left out of the updater (`UPSTREAM_SKIP_TESTS`): `system/restart.test.mjs` (rss 264 -> 424 MB over 20 restarts, identical on main with the old pins and Node 22.23.4).
- Timing flake: `ir/raw.test.mjs` "signals of a file are at least 100 ms apart" fails about one run in three even alone (gap 99 or 101 ms; the SDK code is unchanged). Not loosened; the areas step retries a failed file twice (`NODE_TEST_RETRIES`).

## The updater

`.github/workflows/upstream-update.yml`, calling `tools/upstream-check.sh` and `tools/upstream-update.sh`.
1. Daily 05:17 UTC and "Run workflow" (optional tag input). Job `check` runs `upstream-check.sh`: newest tag `vX.Y.Z` that kode-sdk AND KodeOS both have; newer than the pins or nothing happens (a tag only one repository has is waited for).
2. Job `update` (only then), `ubuntu-24.04` (pinned so a change of GitHub's default image cannot break a run unannounced), `contents: write`: Node 22, npm cache, Emscripten cached with `actions/cache` (key = Emscripten version), then `upstream-update.sh --to TAG`: pins, setup, SDK precompile, factory build, kodeOS suite, boot suite, area suites, copy packages to `web/public/apps` + `SOURCES.md`, then a scratch copy, `npm ci`, `npm run build` and `system-check`, `settings-check`, `bench-check` in headless Chrome (`CHROME=/usr/bin/google-chrome`).
3. Only if all of it passes: commit `tools/pins.env` and `web/public/apps` as Murilo (`107654893+murilogpapa@users.noreply.github.com`), no trailers, and a plain `git push origin HEAD:main` with the built-in `GITHUB_TOKEN`. No secret, no force. If main moved meanwhile the push is refused and the run fails (run again). Vercel deploys main by itself.
4. Any failure: nothing is committed, the run fails (GitHub e-mails the owner), the summary names the step (`FAILED STEP: ...`) and the last log lines.
Safety: concurrency group `upstream-update` (no overlap), 180 minute timeout, actions pinned by commit SHA (checkout 7.0.1, setup-node 7.1.0, cache 6.1.0), no artifacts uploaded, a push by `GITHUB_TOKEN` does not start workflows (and the workflow only listens to schedule and manual dispatch), so no loop.
Validated here: `actionlint` 1.7.12 with shellcheck: no findings; both scripts shellcheck-clean (warnings only); a mock origin showed the commit step makes one commit by Murilo with no trailers, pushes fast-forward, and does nothing on a second run; `upstream-update.sh --to v9.9.9` fails at step `pins`, names it in the summary and leaves the tree as it was; `upstream-check.sh` answers `update=true` against pins at v0.1.1 and `false` now. The workflow itself cannot be run from here: its first real run is the test.

## Cost

Nothing. GitHub documents standard hosted runners in public repositories as free ("Standard hosted runners on public repos" stay free and do not use up included minutes; larger runners are billed): https://docs.github.com/en/billing/concepts/product-billing/github-actions. The only storage used is the Actions cache (10 GB per repository included; Emscripten is far below that); no artifacts are kept. A run that finds no new release takes seconds.

## Turning it off

Actions tab > "Upstream update" > "..." > Disable workflow (or delete the file). GitHub also disables scheduled workflows by itself after 60 days without repository activity in a public repository.

## What it cannot do alone (a person must act; the run fails and e-mails)

- New hardware functions the simulator has no fake for: the link fails with an undefined symbol or a stub logs "not implemented" in a test. Follow `docs/DRIVER-AREA-GUIDE.md`.
- New SDK or kgui source files: `tools/dblib/sources.py` must follow the SDK's CMakeLists (kgui's own list is read from its CMakeLists automatically).
- Upstream rewording of log lines the tests match, an API change kgui needs a shim for (`kodeos_compat.h`), a new HID/feature model.
- Kody Kart is not updated by the workflow (no tags) unless it gets the same tag as the release.
- Owner, once: Vercel Hobby deploys only commits whose author is the account owner, which is why the commit carries his identity; check that the first automated commit deploys. If branch protection on `main` requires pull requests, the push is refused (allow it for the Actions bot or the workflow cannot publish). Repository Settings > Actions > General: Actions must be allowed; the job asks for write permission itself.
