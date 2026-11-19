# STATUS: KodeCity preinstalled

Branch `feat/kodecity`. KodeCity (https://github.com/kodediy/kode-app-kodecity, GPL-3.0, no tags) is pinned by commit `f0b024d07d36c2d6cc99e4fb370f5e588b86d023` (`KODECITY_COMMIT` in `tools/pins.env`), fetched by `tools/setup.sh` like Kody Kart, second in `tools/factory-apps.json`, built unmodified.

## What the game needed from the simulator

It draws with a software 3D renderer into two 272x332 pictures and scales them to the glass with `kscreen_pic_scale`, which is the P4 pixel accelerator (`CONFIG_KODE_COMPOSE=y`). Nothing of that existed for apps, so:
- New area `runtime/drivers/ppa` (role `app`): `esp_cache_msync` (no-op) and `driver/ppa.h` (client, fill, scale/rotate/mirror, blend) in software, under the SDK's own `kdrv_compose.c`, its checks, AO_Display's compose step and `kscreen_pic_*`, all unmodified. It turns `CONFIG_KODE_COMPOSE` on for the app role and sets the two cache line sizes (64) that `kdrv_compose.c` asserts on.
- `tools/dotbench`: `SEES_SDKCONFIG`, one SDK file (`kdrv_compose_check.c`) is compiled with `-include sdkconfig.h`. The file reads `CONFIG_KODE_COMPOSE` without including it (the ESP-IDF build hands it over on the board), so without this its fill and blend checks were silently left out and the link failed.
- `runtime/web-adapter/dotbench-system.js`: the page's sync of the apps' data folders now runs again when the firmware held the volume (EBUSY). A fourteenth, larger app made AppMgr's copy to the card last longer and `system-check` hit that error in two of four runs; three runs after the change pass.

Assumptions (the hardware cannot be measured here): scaling picks the nearest pixel at the pixel centre (the board may interpolate, so edges are a little harder), rotation is counter-clockwise, a blend is foreground at alpha over an opaque background, RGB565 only. Memory: the default 96 MB package heap was enough (the game logs 256 KB internal heap free, no allocation fell back).

## Numbers
- In the page (headless Chrome, 2D view): the status bar reports 56 to 58 fps while driving. In Node the glass gets about 58 fps; the game's own `fps` variable reads 270 to 360 (it renders faster than it can present, it is not paced; the rasteriser costs about 2 ms a frame here against about 30 fps on the board). This keeps one core busy.
- `tests/node/boot/kodecity.boot-test.mjs`: launches from kodeOS by touch, draws, moves with the D-pad, returns home. `web/scripts/kodecity-check.mjs`: the same through the page's Apps menu, two screenshots, fps.
- Suites: `tests/node/kodeos/run.sh` 81 ok; `tests/node/boot/run.sh` 42 ok (14 factory apps launch and return); web unit tests 503 ok; `system-check` 25 PASS (three runs in a row); `bench-check` all PASS.
- Seen once in the page (not in Node): `kaos.haptic the RTP FIFO ran dry` in the console at game start, a load artifact of the haptic feeder being starved while the page loaded; zero in later runs.
