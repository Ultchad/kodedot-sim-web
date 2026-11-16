# Driver area guide

How to add or change one hardware area (NFC, RFID, radio, IR, SD, battery, motion, audio, ...) of the bench
without touching anyone else's files. Everything below was exercised: a throw-away `zzprobe` area (C export,
JS glue, build, browser call) was built and removed while writing this.

## 1. Folder layout

```
runtime/drivers/<area>/
  area.json            manifest (the only required file)
  *.c, src/*.c         compiled into the runtime (default globs)
  <name>.js            JS glue, optional (listed in "js")
  testapp/             optional C app only this area's tests need
tests/node/<area>/*.test.mjs     Node tests (picked up by tests/node/run.sh <area>)
```

Adding an area touches only those two folders. `tools/dotbench` finds areas by globbing
`runtime/drivers/*/area.json` and `runtime/*/area.json`; the folder name must equal `"area"`. Shared headers:
`kweb_bridge.h` (bridge) and `dotbench_board.h` (virtual board). Do not edit another area's files; if you need a
hook there, ask its owner.

## 2. The manifest (`area.json`)

All keys but `area` are optional.

| key | meaning |
|---|---|
| `area` | name == folder |
| `description` | one line |
| `supersedes` | `{ "components/khal/x/src/khal_x_esp.c": "reason" }`: SDK files that are not compiled (see 5) |
| `sources` | globs relative to the folder, default `["*.c", "src/*.c"]` |
| `i2c_chips` | C functions `void f(void)` that register virtual I2C chips (see 4) |
| `exports` | C functions the page may call (`"zzprobe_get"`); `tools/dotbench` adds the `_` prefix |
| `sdkconfig` | `{ "CONFIG_X": "y" }` Kconfig values applied after the web defaults |
| `js` | glue files, packaged as `glue/<area>/<file>` in the `.dotbench` |
| `test_apps` | apps the area's tests need: `"sdk:examples/<name>"` or `"area:<path>"` |
| `roles` | build roles the area belongs to: `["app"]`, `["kodeos"]`, or both (default). `dotbench build/sdk --role kodeos` builds the OS firmware; an area that serves one firmware only (e.g. `kodeos_boot`: stubs and stand-ins kodeOS needs) lists just that role, so none of it reaches an app. Two areas of the same role superseding one SDK file is a build error naming both. |

Two areas superseding the same file is a build error. A bad manifest stops the build with its path.

`dotbench areas` lists what was found (`--json` for tools).

## 3. Choose the seam

Fake at the lowest layer that the real SDK code above it still runs unmodified. Order of preference:

1. **A virtual I2C/SPI chip** under the real SDK driver (`kdrv_*`, `khal_i2c`): the SDK's own register logic runs,
   you model the chip. Used for the TCA6408A (buttons), KTD2026 (LED), CST820 (touch).
2. **A `khal_*` replacement** (`supersedes` the `*_esp.c`): when no bus exists in the SDK (GPIO, NVS, display, time,
   system, console). The SDK keeps everything above (`kdrv_*`, AOs, services).
3. **A `kdrv_*` replacement**: only when the driver is the hardware (display flush) or too chip-specific.
4. **Nothing**: a missing symbol is turned into a generated stub (section 5): returns `KODE_ERROR`/0/NULL and logs
   once `dotbench: <fn> not implemented`. Park behaviour that must not break apps (RFID, codec) is written by hand:
   `rfid_park_web.c`, `codec_park_web.c`.

## 4. Registering a virtual I2C chip

```c
#include "dotbench_board.h"
static int rd(void *ctx, uint8_t reg, uint8_t *buf, size_t len) { /* fill buf */ return 0; }  /* 0 = ACK */
static int wr(void *ctx, uint8_t reg, const uint8_t *buf, size_t len) { return 0; }
void my_chip_register(void)                       /* name goes in "i2c_chips" */
{
    static dotbench_i2c_chip_t chip = { .addr = 0x44, .name = "my_chip", .read = rd, .write = wr, .ctx = 0 };
    dotbench_i2c_register(&chip);
}
```

`area.json`: `"i2c_chips": ["my_chip_register"]`. `build/gen/areas_gen.c` (generated, never edited) calls it from
`khal_i2c_init()`. An unregistered address NACKs, as on the board. Interrupt/enable lines: drive a pin with
`dotbench_gpio_drive(pin, level)`; the fake `khal_gpio` delivers the edge/level interrupt to the SDK ISR path
(example: TP_INT in `gpio/ioexp_tca6408a.c`, `touch/touch_cst820.c`).

## 5. Superseding an SDK file; how stubs disappear

`supersedes` lists SDK-relative paths. The listed file is skipped by `dotbench sdk`; your C must define every
symbol that file defined, or callers get a generated stub instead. Stubs are produced in `build/stubs/` by
preprocessing the khal/kdrv headers with the real config and removing every symbol an object file defines
(`nm` over the compiled runtime and SDK objects, `build/defined.txt`). So: define a function in your area and the
stub for it vanishes on the next `dotbench sdk`; no list to edit. `tools/dotbench sdk` prints
`<n> stub functions`; the count should drop when you implement things. Never edit `build/`.

## 6. Exposing state and inputs to JS

Two mechanisms, pick by data shape:

* **The bridge struct** (`kweb_bridge.h`), for things every page needs (frame, LED, buttons, text). New fields go
  inside `growth[160]` (offset 0x120), never moving others: take a block, add a `_Static_assert` on its offset in
  `kweb_bridge.c`, document it in `runtime/bridge/README.md`, and ask the coordinator to extend `OFF` in
  `web-adapter` (the adapter is not area-owned).
* **Area exports + glue**, for everything else and where you own the whole path:

```c
/* runtime/drivers/zzprobe/zzprobe_web.c */
#include <emscripten.h>
static volatile int g_v;
EMSCRIPTEN_KEEPALIVE int zzprobe_get(void) { return g_v; }
EMSCRIPTEN_KEEPALIVE void zzprobe_set(int v) { g_v = v; }     /* called on the page's thread */
```
```json
{ "area": "zzprobe", "exports": ["zzprobe_get", "zzprobe_set"], "js": ["zzprobe.js"] }
```
```js
// runtime/drivers/zzprobe/zzprobe.js: default export, called at every boot with a context
export default function (ctx) {
  return { set: (v) => ctx.call("zzprobe_set", v), get: () => ctx.call("zzprobe_get") };
}
```
Page: `device.area("zzprobe").set(42)` (null when nothing runs). **Glue contract**: ES module, default export
`(ctx) => api`. `ctx`: `module` (Emscripten Module), `statePtr`, `u32(off)`, `i32(off)`, `setU32(off, v)` (bridge
struct), `call(name, ...args)` (an export), `alloc(n)`/`free(p)`, `heap()` (current `HEAPU8`; re-fetch, memory is fixed
at 96 MB so the view stays valid), `emit(type, data)` (becomes `dev.on("area:<area>:<type>")`), `onTick(cb)` (runs
every poll, ~20 ms). Glue runs on the main thread, must not block, and is recreated per boot (keep no state in it
that C does not own). Data over 32 bits: pass a pointer from `alloc`.

## 7. Threading rules

* Firmware threads are pthreads (Web Workers); the FreeRTOS layer maps each task to one. The page (main thread) calls
  exports and reads shared memory; it must never block and never take a mutex that C holds long.
* `kweb_button`/`kweb_touch` already follow the pattern: lock-free ring + pump thread. Fakes called from a driver
  (`read`/`write` of a chip, `khal_*` replacements) run on the calling task's thread, so they may block briefly but
  must not wait on the page (nothing replies synchronously).
* `main()` runs on a pthread (`-sPROXY_TO_PTHREAD`), but an exported function the page calls runs on the page's own
  thread. Keep it to: write a
  volatile/atomic, push into a ring, return. Never `pthread_mutex_lock` for long, never sleep, never `xQueueSend` with a
  timeout from it.
* **Posting an event into an Active Object from the "hardware" side**: the RTOS layer has no ISR context, so
  `xQueueSendFromISR` and friends are the plain task calls (`runtime/rtos/README.md`). From the "hardware" side
  call the SDK's normal ISR-side path with timeout 0: either raise the line (`dotbench_gpio_drive`, which runs the
  registered GPIO handler on the calling thread) or post with `xQueueSendFromISR`/the AO's post-from-ISR function.
  Do it from a fake-owned thread or from a hook that runs on the input pump, not from an export if the post could wait:
  an export writes an atomic or pushes a ring and returns; the pump thread (woken with `emscripten_futex_wake`) does
  the posting. A zero-timeout post never blocks; a full queue drops the event as on hardware.
* Shared fake state: one `pthread_mutex_t` per chip model (see `led_ktd2026.c`), critical sections without calls into
  the SDK.
* A thread that calls `kweb_restart` is parked; do not hold locks while calling it.

## 8. Node tests for the area

`tests/node/<area>/<name>.test.mjs`, plain Node (no framework); import `../harness.mjs`:

```js
import { boot, pkgPath, OFF, BTN, sleep } from "../harness.mjs";
const a = await boot(pkgPath("buttons_led"));            // a.M, a.u32(off), a.button(id,d), a.touch, a.logText(),
await a.waitFor(() => a.led().join() === "0,32,0", 5000, "green");   // a.framebuffer(), a.snapshot(), a.shutdown()
a.shutdown(); process.exit(0);                            // exit non-zero on failure
```
Run: `tests/node/run.sh <area>` builds what is missing (SDK libraries, the two stage-0 examples, the area's
`test_apps`), then runs the RTOS tests, the two acceptance tests and `tests/node/<area>/*.test.mjs`. With no area it
runs every area's tests. `DOTBENCH_BUILD=dir` isolates the build. The Node harness does not load JS glue; test the
C exports through `a.M._<export>(...)`, and the glue in the browser test if it matters.

## 9. Build dirs, parallel work, seeding

`--build DIR` or `DOTBENCH_BUILD` is the only place `tools/dotbench` writes (objects, libs, config, stubs, apps,
generated files, caches), so two agents with different dirs never collide; verified with two concurrent builds, the
other dir untouched. Paths inside are normalised, so a dir can be copied:

```
tools/dotbench --build /tmp/mine seed build      # copy of the finished build/ (~1900 files), paths rewritten
DOTBENCH_BUILD=/tmp/mine tests/node/run.sh <area> # rebuilds only what your files changed
```
Without seeding, the first `dotbench sdk` of a new dir compiles everything (minutes on 2 cores).

## 10. Persistence: the persistent-region service

Everything that must survive a restart, a power cycle or a page reload is a **region**: a fixed buffer in the firmware's
memory that the host mirrors to durable storage (IndexedDB in the page, a directory under Node). Settings (NVS), the
internal and SD file systems, the clock and the NFC bench objects are regions. Design and numbers:
`docs/STATUS-persistence.md`; the whole-device view: `docs/STATUS-integration.md`.

**Registering a region** (C, from a constructor; header `runtime/bridge/dotbench_persist.h`, already on the include path):

```c
static uint8_t g_store[8 * 4096] __attribute__((aligned(64)));            /* size: a multiple of 4096; address 8-aligned */
static dbp_region_t *g_reg;
__attribute__((constructor(120))) static void reg(void) { g_reg = dbp_register("my-area", g_store, sizeof g_store, 0); }
/* write:  dbp_write(g_reg, off, src, len)        or   memcpy(g_store + off, ...); dbp_dirty(g_reg, off, len);   (mark AFTER writing) */
```

Rules: name <= 15 chars and unique; at most 16 regions in total (`DBP_MAX_REGIONS`; `KWEB_PERSIST_MAX` is 16 too); the size is part of
the format: a build that registers another size starts that region empty (event `region-ignored`), so choose it once; flag
`DBP_FLAG_RETAIN` makes a RAM-like region (cleared at power-on, kept on reset, never sent to durable storage: "keep"). Memory is not free:
the wasm heap is a fixed 96 MB and about 35 MiB of it is already static regions (the SD card alone is 32 MiB). The old
`kweb_persist_register(name, ptr, size)` still works (the host saves such a region in full at stop/restart only, with no
dirty bits); new code should use `dbp_register`, which also keeps the old table in step for regions up to 1 MiB.

**When is data flushed?** The host loads the saved bytes into the fresh memory before `main()`. While the device runs, a
region's dirty bits (one per 4 KiB chunk, set by `dbp_write`/`dbp_dirty`) and one generation counter are polled by the adapter;
dirty chunks are compared with what the host already holds and only the changed ones are committed (one IndexedDB
transaction per flush). A flush starts 800 ms after the last write, or after 5 s of continuous writing; it always completes at
`stop()`, `restart()`, `eraseDevice()` and is attempted at `pagehide`/`visibilitychange`. A hard tab kill loses at most the
debounce window. A writer that never marks dirty bits is still saved at stop/restart (full compare) but not in between.
`dbp_cut_after(n)` / `dbp_cut_fired()` injects a power cut for tests (the write that straddles n bytes is torn, later ones are dropped).

**Higher level services built on it** (use these instead of a region of your own when they fit): `kode_setting_*` / NVS
(`khal_nvs_web.c`, 64 KiB crash-safe log), files on `/storage` and `/sdcard` through the SDK's own `kdrv_storage` (real FatFs), the clock
(`dev-state` holds the RTC offset). From the page: `device.area("storage")` (file API), `sd`, `nvs`, `time`; whole device:
`flushPersist()`, `eraseDevice()`, `exportDeviceFile()`, `importDeviceFile()`.

**Factory content.** A package may carry `factory/storage/**` (listed in `manifest.json` under `factory`): the storage driver copies it onto
the internal volume once, when it formats a blank volume at mount time (fresh device, "erase device"). An existing volume is never touched;
a package without a factory tree just gets an empty formatted volume. See STATUS-integration.md section 4.

Tests: `tests/node/persist/host.mjs` (`Bench`: a device on a directory, any number of boots, `run.stop()` commits like the adapter),
`tests/node/{persist,nvs,storage,sd,time}`, `tests/browser/persist.test.mjs`.

## 11. Definition of done

- [ ] Everything lives in `runtime/drivers/<area>/` and `tests/node/<area>/`; no other file edited (a bridge-struct
      field is the one coordinated exception).
- [ ] `area.json` valid; `dotbench areas` shows it; every superseded SDK file has a reason.
- [ ] `tests/node/run.sh <area>` passes from a clean seeded build dir, including the two acceptance tests.
- [ ] The SDK example(s) that use the hardware run unmodified; no `dotbench: ... not implemented` log for functions
      the example calls.
- [ ] Inputs never block the page; no lock held across an SDK call; restart safe (nothing left running or
      allocated across `kweb_restart`; state that must survive is in a persist region, the rest is RAM).
- [ ] JS glue (if any) is a default-export function, non-blocking, with its API listed in the area's test or a header comment.
- [ ] The bridge README documents any new struct field or export; offsets pinned by `_Static_assert`.
- [ ] Stub count did not grow; `rm -rf build/obj` is never needed to get a correct build.
