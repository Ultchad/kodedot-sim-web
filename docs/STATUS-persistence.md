# Persistence and storage: status

Branch `area/persist`. Settings, files, the microSD, the clock and the device state now survive restarts, power cycles and
page reloads. Everything is built on one service, the **persistent-region service**.

## 1. The seam

```
firmware (SDK, unmodified)                    dotbench                                   host (page / Node)
kode_setting_* -> kdrv/khal_nvs  ------------> runtime/drivers/nvs   (record log)  --+
kdrv_storage.c -> fopen/stat/opendir --------> runtime/drivers/storage vfs.c (FatFs) -+--> regions in wasm memory --> PersistManager
kdrv_sd.c      -> khal_sdmmc_*  -------------> runtime/drivers/sd      (virtual card)-+     (dirty bits)               (persist.js)
khal_time_esp.c -> gettimeofday (wrapped) ----> runtime/drivers/time   (dev-state)   -+                                  |
                                                                                                          IdbBackend | NodeDirBackend
```

Real SDK files still running: `kdrv_storage.c`, `kdrv_sd.c`, `kdrv_fs.h` users, `khal_time_esp.c`, `khal_time_zone.c`, `kode_setting.c`,
AO_Storage, the console file verbs. Superseded (reason in each `area.json`): `khal_nvs_esp.c`, `kdrv_fs.c`, `khal_sdmmc_esp.c`.

## 2. Regions

| name | size | holds | flags |
|---|---|---|---|
| `nvs` | 64 KiB (`partitions.csv`: nvs 0x10000) | khal_nvs record log | |
| `flash-fs` | 2 MiB (`partitions.csv`: storage 0x200000) | FAT volume mounted at `/storage` | |
| `sd-card` | 32 MiB static | the virtual card: dense sectors of a card <= 32 MB, or the first pool of a bigger one (section 12) | |
| `sd-map` | 68 KiB | the big card's page table (header + directory), section 12 | |
| `sd-pool2` | 24 MiB static | second pool of a card > 32 MB | |
| `dev-state` | 4 KiB | RTC offset, SD slot state (inserted, capacity, serial, write protect, generation) | |
| `keep` | 1 MiB (boot_web.c) | RTC RAM | RETAIN: cleared at power-on, never mirrored |
| `apps` | (boot-model engineer) | | |

Limits: 16 regions in the dbp table (`DBP_MAX_REGIONS`); the legacy `kweb_persist_register` table is still 8 (`KWEB_PERSIST_MAX`, shared file: coordinator should raise it to 16), name <= 15 chars, 8-byte aligned buffer, size a multiple of 4096, fixed per
build (a changed size starts that region empty and emits `region-ignored`), 256 MiB of dirty bitmap in total.

**C API** (`runtime/bridge/dotbench_persist.h`): `dbp_register(name, buf, size, flags)` (from a constructor; idempotent), `dbp_find`, `dbp_buf`,
`dbp_size`, `dbp_write` / `dbp_fill` (copy + dirty marking, subject to fault injection), `dbp_dirty(r, off, len)` (call AFTER writing in place),
`dbp_cut_after(bytes)` / `dbp_cut_fired` / `dbp_cut_clear` (power-cut injection: the write straddling the limit is torn, later ones dropped),
`dbp_devstate()` / `dbp_devstate_changed()`. Host exports: `dbpx_*` (table, dirty bits, generation).

**Host** (`runtime/web-adapter/persist.js`, `persist-idb.js`, `persist-node.js`): the host holds a sparse image (4 KiB chunks, all-zero chunks omitted)
per region. Load before boot (`restoreInto`), watch the dirty bitmaps (`tick`, cheap: one 32-bit generation load per poll), debounced flush
(800 ms quiet, 5 s at most), full compare + commit at stop/restart (`finalize`, after the workers are terminated), best-effort flush at
`pagehide` / hidden. A flush clears a dirty bit before copying the chunk, writers set it after writing: nothing is lost, a chunk may be copied twice.
Backends: `load() -> {format, regions}`, `commit({meta, puts})` (one IndexedDB transaction per flush), `erase()`. Format number `PERSIST_FORMAT = 1`; a store
with another format is ignored with an `incompatible` event, never thrown.

**Adapter API** (additive; see runtime/web-adapter/README.md): `new DotbenchDevice({persist})`, `persist`, `flushPersist()`, `eraseDevice()`,
`exportDeviceFile()`, `importDeviceFile(bytes)`; `exportPersist/importPersist/factoryReset` keep working.

## 3. NVS

`khal_nvs_web.c`: 16 pages of 4 KiB, CRC32-protected typed records (u8, u64, str, blob index + blob chunks of 3968 B, tombstones), newest serial wins,
compaction into the one page kept free, recovery when a power cut left no free page. The SDK contract is exact: namespaces/keys <= 15 chars, getters
`DENIED` for absent keys, type mismatch or short buffer `ERROR`, strings <= 4000 B, erase of a missing key `OK`. Tested with the SDK's own
`tests/host_nvs/cases/test_khal_nvs.c`, compiled UNCHANGED against a Unity shim: 26 cases x 3 rounds (rounds 2, 3 over a store that survived a restart);
20 restarts with all four types and a 2-chunk blob; stopped at 50 random points and 40 torn writes while rewriting a blob.

## 4. Internal storage: FatFs on a region (why not the Emscripten FS)

* The firmware runs on pthreads (Web Workers). Emscripten's FS lives on the main thread, is not exported by the build, and a worker's file call would
  be proxied to the main thread: that blocks the page behind the firmware (or deadlocks), which the area guide forbids.
* A real FAT volume on a byte region has the board's semantics: cluster size, free/used space, `ENOSPC`, 8.3 + long names, no replace on rename,
  and the on-media format of a real card, so a later "download / load card image" is a copy into a region.
* One persistence mechanism (regions) for everything; no second async path (IDBFS sync) to reason about. Power-cut behaviour is testable byte by byte.
* Cost: FatFs R0.16 (ChaN, IDF's copy, `runtime/drivers/storage/fatfs/`, `ffconf.h` derived) is vendored, ~6k lines.

Sizing: `partitions.csv` storage = 2 MiB -> 512 sectors of 4096 B (the wear-levelling sector size, `FF_MAX_SS`), formatted `FM_ANY|FM_SFD` like IDF -> FAT12, one
FAT, 4 KiB clusters, **2024 KB usable** (what the log prints: `2024KB free of 2024KB`). The SD uses 512 B sectors; an MBR card image still mounts.

How the real `kdrv_storage.c` reaches it: it calls libc on `/storage/...` and `/sdcard/...`. `runtime/drivers/storage/include/dirent.h` is a **shadow header**: only
`kdrv_storage.c` includes `<dirent.h>`, so only it gets `fopen/fclose/fread/fwrite/fseek/ftell/ferror/remove/rename/mkdir/rmdir/stat/opendir/readdir/closedir`
redirected to `dbfs_*` (vfs.c), which serve the two volumes from FatFs and forward every other path to the real libc. Writes are buffered (1 KiB) so a full
volume shows at `fclose`, as the SDK expects. errno follows ESP-IDF `vfs_fat.c`, with two POSIX corrections the SDK relies on (parent is a file ->
`ENOTDIR`, create over a directory -> `EISDIR`), and `ENOSPC` instead of `EACCES` when a create fails on a full volume.
Limits: 8 open files, 8 open directories (the SDK uses 2), path 160 chars here (the SDK's own limit is 96), names 255 chars (LFN), 1 volume lock.

**Page-side file API** (`storage.js`, `device.area("storage")`): `list stat read readText write({append, offset}) truncate remove mkdir({parents}) rename usage format mounted`,
typed `FsError {code: "ENOENT" | "EEXIST" | "ENOSPC" ...}`, event `changed`. **Safe while the firmware runs**: every call is one FatFs operation under the same lock the
firmware takes, taken with a bounded try (never blocks the page; `EBUSY` after ~200 retries). You may read a file the firmware is writing and get what has been flushed so far (up to
1 KiB behind). The device must be running (or use the device file when stopped): there is no FAT reader in JS.

## 5. microSD

A virtual card (`khal_sdmmc_web.c`, `sd.js`). CID/CSD identity is synthetic (`DOTSD`, SDHC, 4-bit, 20 MHz). A factory device ships with an 8 MB FAT card inserted. Capacity 2 MB..256 GB nominal, section 12
(`sd.swap(mb, {format})`: a new card with its own serial, blank or FAT formatted; its sectors are the `sd-card` region, so the old card is gone). The SDK has no card-detect
event, and neither does this: insert does NOT mount, the firmware mounts (`sd_mount` / its boot probe), as on the board. A blank card answers `sd_mount` like the board does
(`KODE_IO_ERROR`, "no FAT volume"). Write protect: `EROFS`.

Pulled while idle: `mounted` turns false at once, every file and sector call fails (`EIO` / `KODE_DENIED`), the card keeps its data, put it back and `sd_mount`.
Pulled during a write: the sector in flight is not written, sectors before it are (sector writes are atomic here, multi-sector writes stop between sectors); the firmware sees `EIO`;
the volume is as consistent as a FAT is after a power cut (no journal: at worst the file being written is short and a few clusters are lost). Tested: 25 random pulls
during continuous writes, the firmware remounts and every earlier file verifies. Events: `inserted removed card mounted unmounted`. `sd.mount()/unmount()` let the page mount without the firmware.

## 6. Time

The device clock = host clock + `rtc_offset_us`, which lives in `dev-state` (`time_web.c`, extending the existing `kweb_time_offset_ms`; the adapter only applies its legacy
`_rtcOffsetMs` when no `dev-state` was restored). Set by the firmware (`time set=`, `settimeofday`) or the page (`time.js`: `now offsetMs set resetToHost`): both survive reset,
power-on and a reload. The zone is the SDK's own setting `config key="zone"` (POSIX TZ string in NVS, applied by AO_Boot). **Emscripten's `localtime_r` ignores TZ** (it renders in the
host's zone), so `tz_web.c` defines `localtime_r` with a POSIX TZ parser (`Mm.w.d`, `Jn`, `n`, `<+03>` names, negative/over-24h times, southern-hemisphere rules). FAT timestamps use it.

## 7. For the boot-model engineer: adding the "apps" region

```c
static uint8_t g_apps[APPS_BYTES] __attribute__((aligned(64)));          /* APPS_BYTES a multiple of 4096 */
__attribute__((constructor(110))) static void apps_reg(void) { dbp_register("apps", g_apps, sizeof g_apps, 0); }
/* write: dbp_write(r, off, src, len)   or   memcpy(g_apps + off, ...); dbp_dirty(r, off, len);   (mark AFTER writing) */
```
Include `dotbench_persist.h` (runtime/bridge is on the include path). The host loads the saved bytes before `main()`, mirrors only dirty chunks, and stores nothing for all-zero chunks.
Budget: dbp table has room (nvs, dev-state, flash-fs, sd-card, apps + other areas; "keep" and the NFC area's "nfc" are legacy-registered); the wasm memory is fixed at 96 MB and ~35 MiB is already static region, so keep `apps` well under 16 MiB. Do not change its size
between builds. If installed apps are better kept as files, `/storage` is a real FAT volume (2024 KB).

## 8. Tests (all under Node unless noted)

`tests/node/persist/persist.test.mjs` (regions, dirty-only flush, debounce, versioning, erase, device file) - `tests/node/nvs/` (SDK cases unmodified; 20 restarts; 50 kills; 40 torn writes) -
`tests/node/storage/examples.test.mjs` (UNMODIFIED `examples/storage` and `examples/console_actions` end to end, 20 restarts, the console file verbs and error codes),
`api.test.mjs` (page API, a volume filled to capacity, use while the firmware writes, export/import a device and compare), `powercut.test.mjs` (50 random stops + 40 torn writes: mounts without
re-format, earlier files intact) - `tests/node/sd/sd.test.mjs` (insert/remove idle and 25 pulls mid-write, capacity, blank/formatted) - `tests/node/time/time.test.mjs` (host clock, set from page and
firmware across reset/power/reload, zone with DST) - browser: `tests/browser/persist.test.mjs` (headless Chrome: data written by an app survives a full page reload through IndexedDB, debounced and
at stop, a file and the clock set from the page too, "erase device" empties IndexedDB, device file round trip).

## 9. Assumptions, discrepancies, risks, not done

* DRIVER-AREA-GUIDE.md section 10 says nvs is a 128 KiB arena; `partitions.csv` says 0x10000. 64 KiB is used. The guide's "not built: IndexedDB" is now built (the guide is not edited).
* `examples/storage` truncates its log on the first press of every boot (its line counter is RAM), so across boots only the last boot's lines remain: that is the example, not a loss.
* **IndexedDB quota**: a fresh device stores ~100 KB; a full 2 MiB volume + a full 32 MiB card 34 MiB at worst. A `QuotaExceededError` rejects that commit, is reported (`persist:error`, `dev.persist.lastError`)
  and the data stays in memory, so the next flush retries. Eviction under storage pressure is the browser's call: pages should request `navigator.storage.persist()`.
* **Flush timing**: a hard tab kill loses at most the debounce window (<= 5 s of continuous writes); `pagehide` flush is best effort (IndexedDB is async and may not finish); a hidden tab polls at 1 Hz so
  the debounce stretches (hence the visibilitychange flush). stop/restart/`eraseDevice` always complete.
* **Memory**: ~35 MiB of the 96 MB wasm memory is static regions; the host image holds only non-zero chunks (a full card doubles it). Under Node every restart creates an instance (RSS grew to ~3 GB over a 90-boot
  test and was reclaimed by GC; do not run many such tests in parallel on small machines).
* FAT has no journal: `rename` is create-then-delete, so a cut between them can leave two names on one chain; an interrupted write loses at most the file being written. NVS is power-cut safe.
* Not built: a JS FAT reader (files are reachable only while the device runs; the device file covers the stopped case), a "load card image" helper (the layout allows it: copy a FAT image into `sd-card` and bump
  the generation), POSIX `truncate/ftruncate` for firmware code (the SDK has none; `truncate` is page-side), Firefox/Safari runs (Chrome only), the `.dotbench` glue is not loaded by the Node harness (the tests drive the glue modules through `host.mjs: run.glue(mod)`).

## 10. Shared files changed (for the coordinator)

* `runtime/web-adapter/dotbench-device.js`: import (line 4); constructor persist manager (45-60, `_onHide`); `start()` (`dropRetained`); `_boot` (open, restoreInto/attach, clock only if no dev-state); `poll` (`tick`); `_teardown` (`finalize`);
  `_snapshot`; `exportPersist/importPersist/factoryReset` and the new persistence methods (253-288); the OTA reload line. `runtime/web-adapter/README.md`: the API rows.
* `tests/node/run.sh`: area lookup falls back to `runtime/<area>/area.json` (needed for `tests/node/persist`).
* New global header dir `runtime/drivers/storage/include/` (the shadow `dirent.h`, `dotbench_vfs.h`) and `runtime/bridge/dotbench_persist.h`.

## 11. To reconcile when merging main

* **How an area registers a region**: `dbp_register("name", buf, size, 0)` from a constructor (section 7); it gets dirty tracking and is mirrored to IndexedDB. Regions registered only with `kweb_persist_register` (NFC `nfc`, `keep`) still work: the host sees them, copies them at stop/restart (full compare), but they have no dirty bits, so they are saved at stop and on the `pagehide` flush only. Recommend the NFC area switch to `dbp_register`. Raise `KWEB_PERSIST_MAX` (kweb_bridge.h) from 8 to 16; the dbp table already holds 16.
* **kodeOS stand-in**: `runtime/drivers/kodeos_boot/storage_memfs.c` supersedes `kdrv_fs.c` just as `storage/kdrv_fs_web.c` does: two areas superseding one file is a build error, so drop the stand-in (and its MEMFS) when merging. The factory tree (`factory/storage/**`) must be copied onto `/storage` once on first boot: not done here. Suggested: after `kdrv_fs_mount` returns with a fresh format (kdrv_fs_web.c knows `formatted`), call a seeding function that writes the embedded tree through `fopen` on `/storage` (the volume is 2024 KB; the pack is 324 KB), and record a marker file.
* nvs: main's `khal_nvs_web.c` (128 KiB arena, constructor + kweb_persist_register) conflicts with this branch's rewrite (64 KiB log, `partitions.csv`); keep this branch's. `STATUS-kodeos.md` says settings live in the `nvs` region: same name, so it carries over.
* Adapter: this branch replaces `_persist` (Map) by a PersistManager in `dotbench-device.js`; resolve any main edits there by hand.

## 12. Sparse microSD: cards from 4 MB to 128 GB (branch feat/big-sd)

The page offers 4, 8, 16, 32, 64, 128, 256, 512 MB and 1, 2, 4, 8, 16, 32, 64, 128 GB (the driver accepts 2 MB .. 256 GB). The firmware sees the nominal card
(`sd_info`: `capacity_mb=131072 sectors=268435456`, the SDK's own `kdrv_sd`, FatFs, VFS above the seam, unmodified); only blocks holding non-zero data occupy
memory and browser storage.

**Design** (`runtime/drivers/sd/sdcard.c`, tests `tests/node/sd/bigsd*.mjs`, `tests/browser/bigsd.test.mjs`).
* Card <= 32 MB: DENSE, sector s at byte s*512 of region `sd-card` (32 MiB), exactly the layout cards saved by earlier builds have: **migration is "do nothing"**
  (tested with a real package of the dense build before it was overwritten in /home/claude/dotbench/build: 8 MB and 32 MB cards with files load, mount and stay writable; the test now emulates it by dropping `sd-map` when that package is a current build). Zero chunks are not stored by the host as before.
* Card > 32 MB: SPARSE. `sd-card` (32 MiB) + `sd-pool2` (24 MiB) are a pool of 4 KiB slots (14336). A two-level table maps card chunk (4 KiB = 8 sectors) to a slot:
  directory in `sd-map` (32768 x u16, 64 KiB, covers 256 GiB), leaves are pool slots (2048 x u16 = 8 MiB of card each). A slot is taken at the first write of a
  NON-ZERO sector into a hole (zeros into a hole do nothing: the SDK's own last-sector write-back check, and mkfs, store nothing), and given back, zeroed (so the host
  deletes the chunk), when the chunk is all zero again; an empty leaf is freed. When no slot is left the sector write fails: FatFs `FR_DISK_ERR` -> `EIO`, `KODE_ERROR`
  from `khal_sdmmc_write_sectors`. The free-slot bitmap is RAM only, rebuilt from the table at the first access (a pool scan, ~10 ms). All writes go through `dbp_write`: the
  existing dirty bits, 800 ms / 5 s flush, one IndexedDB transaction, power-cut injection and device file apply unchanged; data is written before the table entries that reach it.
* Threads: one mutex around a sector transfer (firmware threads), held only for the transfer; no wait inside. The page never takes it for long: a new card requested by the page
  is a lock-free write of the slot state plus an epoch bump (`dbsd_card_changed`); the firmware side wipes and re-sizes the table at its next access (the glue also calls
  `dbsd_page_apply` right after `swap`: a bounded spin, so the old card's chunks leave the store at once). A formatted new card is formatted at its first mount (`sd_initialised = 0`,
  as the factory card always was). `sd.stats()` and the other page calls are atomic loads.
* Format: an MBR with one partition at LBA 63 (`FM_ANY`, not super-floppy; the flash volume keeps FM_SFD), data aligned to 1 MiB from 256 MB up, 32 KiB clusters from 32 GB up.
  4..32 MB FAT12/16 (type 01/04), 64 MB..2 GB FAT16 (06), 4 GB..128 GB **FAT32** (0c). 128 GB: usable 131055 MB, free 131054 MB.

**FAT32, not exFAT.** Real 64..128 GB cards ship as exFAT, but the SDK says outright that a card "with no FAT volume (exFAT, or none)" is `KODE_IO_ERROR` (`khal_sdmmc.h` mount
contract, `kdrv_sd.c` "the card has no FAT volume to read (exFAT, ...)"): the board's FatFs is built without exFAT, so kodeOS cannot mount one. A 128 GB card here is what people format for such
devices: FAT32 with 32 KiB clusters (the vendored FatFs has the exFAT code, `FF_FS_EXFAT` is 0 in our ffconf as in the SDK; turning it on would make the bench accept cards the board rejects).

**Limits, measured.**
* Real data per card: **56 MiB** (14336 slots; 14329 accepted in the fill test, the rest is page table: one 4 KiB leaf per touched 8 MiB of card). Where it comes from: wasm memory is a fixed 96 MB (`INITIAL_MEMORY`,
  no growth). Static regions end at 44.5 MiB; the firmware's malloc heap lives above: kodeOS 8.2 MiB used (sbrk at 52.7 MiB at the launcher), the apps 48..52 MiB; so about 43 MiB were unused. The
  second pool takes 24 MiB of that and leaves >= 19 MiB for kodeOS (2.3x its use). To hold more, raise `DBSD_EXTRA_MB` in sdcard.c together with the build's memory (`-sINITIAL_MEMORY`, shared tool/`K.MEMORY_MB`);
  the page shows it from `sd.stats()`: `{storedBytes, boundBytes, poolBytes, layout, known}` ("128 GB card, 37 MB used of about 56 MB this browser can hold").
* IndexedDB: quota is not the limit. Headless Chrome reported a 10240 MB quota; the store holds the stored chunks only (a 128 GB card with a 3 MB file: 799 chunks = 3.1 MiB, tested in Chrome; the host's
  sparse image keeps a second copy in the page's JS heap).
* A card <= 32 MB holds its full capacity (dense), as before.
* Format of a new 128 GB card: 6..11 ms (swap + mkfs + mount, Node), **20480 bytes stored** (5 chunks: boot sector/FSInfo/FAT head/root directory/leaf), the same for 4 GB..128 GB; 12..16 KiB for the smaller cards.
* A 3 MB file on a 128 GB card stores 3 MB + ~100 KiB of FAT, directory and table.

**What the firmware shows for a 128 GB card** (kodeOS, `tests/node/sd/bigsd.kodeos-test.mjs`): boot log `card mounted at /sdcard: 'DOTSD', 131072MB`; `sd_info`: `capacity_mb=131072 sectors=268435456`,
`total_mb=131055 free_mb=131054`, console `total_kb=134200320 free_kb=134200288`; Settings > About: "microSD card 128.0 GB" (`docs/sd-shots/kodeos-about-128gb.png`). kodeOS shows the free space only in the console.

**Tests** (all run, see the commands in the final report): `bigsd.test.mjs` 9 checks (16 sizes; raw sectors at 0, 1, 7, 8, a middle and the last sector of 128 GB; files at any place; fill to the bound and EIO, zeros into a hole still work at the bound,
freeing makes room; reload from the persisted state; migration of dense cards; eject/insert/swap; a power cut at 10 random byte counts on a 64 GB card; 12 pulls mid-write on 64 GB),
`bigsd.kodeos-test.mjs` 2, `tests/browser/bigsd.test.mjs` 2 (real IndexedDB; not in `run.sh`). `sd.test.mjs` (4) changed in one place: the capacity range check is now 2 MB..256 GB (it asserted 33 MB is refused).
`persist.test.mjs` lists the regions of the app role: `sd-map` and `sd-pool2` were added to its expected list.

**Not done / does not work.** exFAT (above). A write that does not fit returns EIO, not ENOSPC (the FAT still shows free space: it is a medium error, as a failing card is). More than 56 MiB of real data per card. A JS FAT reader (as before).
A card swapped while the firmware has it mounted reads as pulled until it is mounted again (as before). The wipe of a swapped card scans the pools (about 10 ms on the page thread). Orphan chunks: a power cut between a data
write and its table entry leaves one non-zero slot nobody references; it is overwritten when reused (never read), and counted as free. `sd.stats().known` is false until the card has been touched since the device started.

**Page changes needed (not made: outside the allowed edit).** (1) The size line "used of total" uses `fmt.bytes` (MB with two decimals: "131,055.00 MB"): it needs a GB step in `i18n/core.ts`. (2) One stored-bytes line in the SD card
(no slot exists): `sd.stats()` -> "37 MB used of about 56 MB this browser can hold" (3 languages), and a "card full" message mapping `EIO` on a big card. (3) A card size larger than the pool deserves a hint that data above about 56 MB will fail.

**Shared files touched:** none of runtime/rtos, runtime/bridge; `runtime/persist` untouched; `runtime/web-adapter` untouched. Changed in the SD and storage areas: `runtime/drivers/sd/{sdcard.c (new), khal_sdmmc_web.c (unchanged), sd.js, area.json}`,
`runtime/drivers/storage/{diskio.c, vfs.c, include/dotbench_vfs.h}`; web: `web/src/bench/sd.ts`, `components/bench/SdPanel.tsx`, `i18n/{en,es,pt-BR}.ts` (size list, labels); tests and `docs/sd-shots/`.
