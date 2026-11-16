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

## 10. Persistence hooks

Built: **in-memory persistent regions** the host copies across restarts of the same page session: `"keep"`
(1 MiB, RTC RAM: cleared at power-on, kept on reset) and `"nvs"` (128 KiB flash arena, kept always). Register your
own fixed buffer in C with `kweb_persist_register("name", ptr, size)` (name <= 15 chars, max 8 regions, size must not
change between builds). Tested by `tests/node/system/restart.test.mjs`.

**Not built: IndexedDB.** The adapter exposes `exportPersist()`/`importPersist(map)`; mirroring them to IndexedDB (on
stop/restart/`pagehide`, reading before `start()`) is page work. A hard crash of the tab loses changes since the last
export. Plan: the page mirrors after every restart and on a 5 s timer, versioned by `manifest.abi_version`. SD-card
images (stage 4) are larger than a region and will need an async path (OPFS) through area glue; not designed yet.

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
