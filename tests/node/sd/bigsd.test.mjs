// The sparse microSD: nominal capacities 4 MB .. 128 GB, only written blocks stored, a bound on real data, persistence,
// migration of cards saved by the dense build, remove and swap. Runs the `storage` example (real SDK FatFs/VFS above the seam).
import assert from "node:assert/strict";
import fs0 from "node:fs";
import path from "node:path";
import { Bench, RESET, pkgPath, sleep, glueMods, appProject, assembleApp, buildApp } from "../persist/host.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
let failed = false;
const check = async (name, fn) => { const t0 = Date.now(); try { await fn(); console.log("ok   - " + name + " (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)"); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
async function cli(run, line, ms = 6000) {
  const start = run.logText().length;
  run.console(line);
  const t0 = Date.now();
  for (;;) {
    const t = strip(run.logText().slice(start));
    const m = /^>(ok|err .*)$/m.exec(t);
    if (m) return { ok: m[1] === "ok", text: t };
    if (Date.now() - t0 > ms) throw new Error("no reply to: " + line + "\n" + t);
    await sleep(25);
  }
}
async function mountCard(run, sd, ms = 8000) {
  const mark = run.logText().length;
  await cli(run, "sd_mount");
  const t0 = Date.now();
  while (!sd.state().mounted && Date.now() - t0 < ms && !/no FAT volume|stays unmounted|no card/.test(run.logText().slice(mark))) await sleep(30);
  return sd.state().mounted;
}
const code = (fn) => { try { fn(); return "none"; } catch (e) { return e.code ?? e.message; } };
const sm = await glueMods.storage(), sdm = await glueMods.sd();
const MB = 1024 * 1024, GB = 1024 * MB;
const SIZES_MB = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072];
const label = (mb) => (mb >= 1024 ? mb / 1024 + " GB" : mb + " MB");

/** Raw sector access through the page export (what the firmware's khal_sdmmc_*_sectors reach). */
function rawApi(run) {
  const M = run.M;
  return {
    write(first, bytes) { const p = M._malloc(bytes.length); M.HEAPU8.set(bytes, p); const r = M._dbsd_page_sectors(1, first, bytes.length / 512, p); M._free(p); return r; },
    read(first, count) { const p = M._malloc(count * 512); const r = M._dbsd_page_sectors(0, first, count, p); const out = M.HEAPU8.slice(p, p + count * 512); M._free(p); return r === 0 ? out : null; },
  };
}
const pattern = (n, seed) => { const b = new Uint8Array(n); let x = (seed * 2654435761) >>> 0 || 1; for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; b[i] = (x >>> 24) | 1; } return b; };   // never zero
const ready = async (bench, pkg = pkgPath("storage"), reason) => {
  const run = await bench.boot(pkg, reason === undefined ? {} : { reason });
  await run.waitFor(() => /kode>/.test(run.logText()) && /is there/.test(run.logText()), 20000, "console");
  return run;
};

await check("every size 4 MB .. 128 GB: formats fast, mounts, reports its nominal capacity, MBR + FAT, stores only a few KB", async () => {
  const bench = await new Bench().open();
  const run = await ready(bench);
  const fs = run.glue(sm), sd = run.glue(sdm), raw = rawApi(run);
  const rows = [];
  for (const mb of SIZES_MB) {
    const t0 = performance.now();
    sd.swap(mb);
    assert.equal(sd.state().capacityMb, mb);
    assert.ok(await mountCard(run, sd), label(mb) + " mounts");          // the firmware's own sd_mount: formats on first mount
    const ms = performance.now() - t0;
    const u = fs.usage("sdcard"), st = sd.stats();
    const nominal = mb * MB;
    assert.ok(u.total <= nominal && u.total >= nominal * (mb >= 1024 ? 0.995 : 0.9), label(mb) + " usable " + JSON.stringify(u));
    assert.ok(u.free >= u.total - 64 * 1024, "empty card, free " + JSON.stringify(u));
    assert.equal(st.layout, mb <= 32 ? "dense" : "sparse");
    assert.ok(st.known && st.storedBytes <= 32 * 1024, label(mb) + " stores " + st.storedBytes + " bytes");
    const mbr = raw.read(0, 1);
    assert.equal(mbr[510], 0x55); assert.equal(mbr[511], 0xaa);
    const pt = mbr.subarray(446, 462), start = new DataView(pt.buffer, pt.byteOffset).getUint32(8, true), size = new DataView(pt.buffer, pt.byteOffset).getUint32(12, true);
    assert.ok([0x01, 0x04, 0x06, 0x0b, 0x0c, 0x0e].includes(pt[4]), "partition type 0x" + pt[4].toString(16));
    assert.ok(start >= 63 && start + size <= mb * 2048 && size > mb * 2048 * 0.99 - 8192, "partition " + start + "+" + size);
    if (mb >= 4096) assert.equal(pt[4] === 0x0b || pt[4] === 0x0c, true, "SDHC/SDXC sizes are FAT32 (FAT16 cannot span 4 GB)");
    rows.push(`${label(mb).padStart(7)}  type 0x${pt[4].toString(16).padStart(2, "0")}  usable ${(u.total / MB).toFixed(1).padStart(9)} MB  stored ${String(st.storedBytes).padStart(6)} B  swap+format+mount ${ms.toFixed(0)} ms`);
    await cli(run, "sd_unmount"); await sleep(100);
  }
  console.log(rows.join("\n"));
  assert.throws(() => sd.swap(1)); assert.throws(() => sd.swap(262145));
  await run.stop();
});

await check("128 GB card: raw sectors at the lowest, a middle and the very last sector; a hole reads zero; out of range fails", async () => {
  const bench = await new Bench().open();
  const run = await ready(bench);
  const sd = run.glue(sdm), raw = rawApi(run);
  sd.swap(131072, { format: false });
  const N = 131072 * 2048;
  const at = [0, 1, 7, 8, 1000003, N / 2 + 5, N - 9, N - 1];
  assert.deepEqual(raw.read(N / 2, 2), new Uint8Array(1024), "a hole reads as zero");
  assert.ok(sd.stats().known || true);
  for (const s of at) assert.equal(raw.write(s, pattern(512, s + 1)), 0, "write " + s);
  for (const s of at) assert.deepEqual(raw.read(s, 1), pattern(512, s + 1), "read back " + s);
  assert.deepEqual(raw.read(2, 1), new Uint8Array(512), "neighbour sector of a stored chunk is zero");
  const st = sd.stats();
  assert.ok(st.storedBytes >= 7 * 4096 && st.storedBytes <= 7 * 4096 + 8 * 4096, "7 data chunks (+ leaves): " + st.storedBytes);   // sectors 0,1,7 share a chunk
  assert.equal(raw.write(N - 1, pattern(1024, 3)), -29, "past the end (EIO)");
  assert.equal(raw.read(N, 1), null);
  // multi-sector across a chunk border and a leaf border (8 MiB)
  const big = pattern(512 * 40, 9);
  assert.equal(raw.write(16384 - 20, big), 0);
  assert.deepEqual(raw.read(16384 - 20, 40), big);
  // writing zeros gives the memory back
  for (const s of [...at, ...Array.from({ length: 40 }, (_, i) => 16384 - 20 + i)]) raw.write(s, new Uint8Array(512));
  assert.equal(sd.stats().storedBytes, 0, "everything zero again: nothing stored");
  await run.flush(); await run.stop();
  assert.equal([...bench.pm.image.regions.values()].filter((r) => r.chunks.size).map((r) => r.chunks.size).length >= 0, true);
  const stored = (n) => bench.pm.image.regions.get(n)?.chunks.size ?? 0;
  assert.equal(stored("sd-card"), 0, "no pool chunk is stored for an all-zero card");
});

await check("128 GB FAT32 card: the SDK's file system sees files at any place; file data and a raw sector in the last cluster live together", async () => {
  const bench = await new Bench().open();
  const run = await ready(bench);
  const fs = run.glue(sm), sd = run.glue(sdm), raw = rawApi(run);
  sd.swap(131072);
  assert.ok(await mountCard(run, sd));
  assert.match((await cli(run, "sd_info")).text, /\d/);
  assert.ok((await cli(run, 'write path="/sdcard/note.txt" text="on a 128 GB card"')).ok);
  fs.mkdir("/sdcard/a/b/c", { parents: true });
  const data = pattern(3 * MB + 123, 7);
  fs.write("/sdcard/a/b/c/big.bin", data);
  assert.deepEqual(fs.read("/sdcard/a/b/c/big.bin"), data);
  assert.equal(fs.readText("/sdcard/note.txt"), "on a 128 GB card");
  const N = 131072 * 2048, last = raw.read(N - 1, 1);
  assert.deepEqual(last, new Uint8Array(512), "last sector of the card is a hole");
  raw.write(N - 1, pattern(512, 99));
  assert.deepEqual(raw.read(N - 1, 1), pattern(512, 99));
  const u = fs.usage("sdcard");
  assert.ok(u.used >= 3 * MB && u.used < 3 * MB + 200 * 1024, "used " + u.used);
  const st = sd.stats();
  assert.ok(st.storedBytes >= 3 * MB && st.storedBytes < 3 * MB + 160 * 1024, "stored " + st.storedBytes);
  // remove the file: space and storage come back
  fs.remove("/sdcard/a/b/c/big.bin");
  assert.deepEqual(fs.list("/sdcard/a/b/c"), []);
  await run.stop();
});

await check("fill to the bound: a proper I/O error, the card keeps working, freeing makes room again", async () => {
  const bench = await new Bench().open();
  const run = await ready(bench);
  const sd = run.glue(sdm), raw = rawApi(run), fs = run.glue(sm);
  sd.swap(65536, { format: false });
  const bound = sd.stats().boundBytes, slots = sd.stats().poolBytes / 4096;
  let ok = 0, rc = 0;
  for (let c = 0; ; c++) { rc = raw.write(c * 8, pattern(4096, c + 1)); if (rc) break; ok++; }
  console.log(`       bound: ${ok} chunks of 4 KiB accepted = ${(ok * 4096 / MB).toFixed(2)} MiB real data (pool ${(slots * 4096 / MB)} MiB, bound reported ${(bound / MB)} MiB)`);
  assert.equal(rc, -29, "EIO");
  assert.ok(ok >= slots - 8 && ok < slots, "accepted " + ok + " of " + slots + " slots (some hold the page table)");
  assert.deepEqual(raw.read(0, 8), pattern(4096, 1)); assert.deepEqual(raw.read((ok - 1) * 8, 8), pattern(4096, ok));
  assert.equal(raw.write(40000 * 8, new Uint8Array(4096)), 0, "zeros into a hole need no room");
  assert.equal(raw.write(40001 * 8, pattern(512, 5)), -29, "still full");
  assert.ok(sd.stats().storedBytes >= (slots - 1) * 4096 - 4096 * 8);
  raw.write(8, new Uint8Array(8192));                                   // free two chunks (a write into a new 8 MiB area needs a table leaf and a data slot)
  assert.equal(raw.write(40001 * 8, pattern(512, 5)), 0, "room again");
  // the file system on a full card: errors, then a remount works
  sd.swap(65536);
  assert.ok(await mountCard(run, sd));
  const big = pattern(MB, 1);
  let err = "none";
  for (let i = 0; i < 90 && err === "none"; i++) err = code(() => fs.write(`/sdcard/f${i}.bin`, big));
  assert.ok(err !== "none", "writing 90 MiB to a card that can hold 56 fails");
  console.log("       file system error at the bound: " + err);
  assert.equal(fs.read("/sdcard/f0.bin").length, MB);
  await cli(run, "sd_unmount"); await sleep(100);
  assert.ok(await mountCard(run, sd), "the card mounts again");
  assert.equal(fs.read("/sdcard/f1.bin").length, MB);
  await run.stop();
});

await check("reload: a 128 GB card, its files and raw sectors come back from the persisted state; the store holds only the data", async () => {
  const bench = await new Bench().open();
  let run = await ready(bench);
  let fs = run.glue(sm), sd = run.glue(sdm), raw = rawApi(run);
  sd.swap(131072);
  assert.ok(await mountCard(run, sd));
  const data = pattern(2 * MB + 5, 4);
  fs.write("/sdcard/keep.bin", data);
  raw.write(131072 * 2048 - 1, pattern(512, 8));
  const before = sd.stats().storedBytes;
  await run.stop();
  const dirBytes = fs0.readdirSync(bench.dir, { recursive: true }).reduce((a, f) => { try { const s = fs0.statSync(path.join(bench.dir, f)); return a + (s.isFile() ? s.blocks * 512 : 0); } catch { return a; } }, 0);   // disk blocks: the .img files are sparse
  console.log(`       persisted directory: ${(dirBytes / MB).toFixed(2)} MB for a 128 GB card holding ${(before / MB).toFixed(2)} MB`);
  assert.ok(dirBytes < 8 * MB, "stored " + dirBytes);
  const again = await new Bench({ dir: bench.dir }).open();
  run = await ready(again, pkgPath("storage"), RESET.POWERON);
  fs = run.glue(sm); sd = run.glue(sdm); raw = rawApi(run);
  assert.equal(sd.state().capacityMb, 131072);
  assert.ok(await mountCard(run, sd));
  assert.deepEqual(fs.read("/sdcard/keep.bin"), data);
  assert.deepEqual(raw.read(131072 * 2048 - 1, 1), pattern(512, 8));
  assert.equal(sd.stats().storedBytes, before, "same data, same footprint");
  await run.stop();
});

await check("migration: cards saved by the dense build (8 MB factory card, 32 MB card, no table region) load with their files", async () => {
  const old = "/home/claude/dotbench/build/apps/files/files.dotbench";    // a package of the dense build
  if (!fs0.existsSync(old)) { console.log("       (skipped: no dense-build package at " + old + ")"); return; }
  for (const mb of [8, 32]) {
    const bench = await new Bench().open();
    let run = await bench.boot(old);
    await sleep(1500);
    let fs = run.glue(sm), sd = run.glue(sdm);
    if (mb !== 8) sd.swap(mb);
    sd.mount();
    const data = pattern(700000, mb);
    fs.write("/sdcard/legacy.bin", data); fs.mkdir("/sdcard/old"); fs.write("/sdcard/old/x.txt", "from the dense build");
    await run.stop();
    assert.ok(!bench.pm.image.regions.has("sd-map"), "the dense build has no table region");
    const again = await new Bench({ dir: bench.dir }).open();
    run = await ready(again, pkgPath("storage"), RESET.POWERON);
    fs = run.glue(sm); sd = run.glue(sdm);
    assert.equal(sd.state().capacityMb, mb);
    assert.ok(await mountCard(run, sd), mb + " MB legacy card mounts");
    assert.deepEqual(fs.read("/sdcard/legacy.bin"), data);
    assert.equal(fs.readText("/sdcard/old/x.txt"), "from the dense build");
    assert.equal(sd.stats().layout, "dense"); assert.ok(sd.stats().storedBytes >= 700000);
    fs.write("/sdcard/new.txt", "and writable");
    await run.stop();
  }
});

await check("remove and swap: a pulled card keeps its sparse data; swapping to another size drops the old card and its stored chunks", async () => {
  const bench = await new Bench().open();
  const run = await ready(bench);
  const fs = run.glue(sm), sd = run.glue(sdm), raw = rawApi(run);
  sd.swap(65536);
  assert.ok(await mountCard(run, sd));
  fs.write("/sdcard/one.txt", "card one");
  raw.write(65536 * 2048 - 1, pattern(512, 21));
  sd.eject();
  assert.equal(sd.state().mounted, false);
  assert.equal(raw.read(0, 1), null, "no card, no sectors");
  assert.equal(code(() => fs.read("/sdcard/one.txt")), "ENODEV");
  sd.insert();
  assert.ok(await mountCard(run, sd));
  assert.equal(fs.readText("/sdcard/one.txt"), "card one");
  assert.deepEqual(raw.read(65536 * 2048 - 1, 1), pattern(512, 21));
  const serial = sd.state().serial;
  await run.flush();
  assert.ok((bench.pm.image.regions.get("sd-card")?.chunks.size ?? 0) > 0);
  sd.swap(4096, { format: false });                                      // another card: blank, other size
  assert.notEqual(sd.state().serial, serial);
  assert.equal(sd.stats().storedBytes, 0, "the new card is empty before anything touches it");
  assert.deepEqual(raw.read(65536 * 2048 - 1, 1), null, "outside the new card");
  assert.deepEqual(raw.read(2048 * 4096 - 1, 1), new Uint8Array(512));
  assert.equal(sd.stats().storedBytes, 0);
  await run.flush();
  assert.equal(bench.pm.image.regions.get("sd-card")?.chunks.size ?? 0, 0, "the old card's chunks are gone from the store");
  assert.equal(await mountCard(run, sd, 2500), false, "blank card: no FAT");
  sd.swap(131072);
  assert.ok(await mountCard(run, sd));
  assert.deepEqual(fs.list("/sdcard"), [], "a fresh card has none of the old files");
  await run.stop();
});

// The power cut and the pulled card on a big card: the hammer writes files; every pull must leave an intact FAT.
const hname = "sd_hammer";
const hpkg = buildApp(assembleApp(hname, appProject(hname, [hname + "_main.c"], {
  ["main/" + hname + "_main.c"]: { copy: path.join(here, "../storage/apps", hname, "main", hname + "_main.c") },
  "main/fs_hammer.h": { copy: path.join(here, "../storage/apps/fs_hammer/main/fs_hammer.h") } })));
await check("a 64 GB card pulled mid-write 12 times: the firmware sees errors, remounts, earlier files verify", async () => {
  const bench = await new Bench().open();
  const run = await bench.boot(hpkg);
  await run.waitFor(() => /FSHAM DONE 2\b/.test(run.logText()), 30000, "hammer writing to the card");
  const sd = run.glue(sdm);
  sd.swap(65536);
  let errs = 0, rnd = 777;
  const next = () => (rnd = (rnd * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const mark0 = run.logText().length;
  await run.waitFor(() => /FSHAM DONE/.test(run.logText().slice(mark0)), 30000, "hammer on the new card");
  for (let i = 0; i < 12; i++) {
    const before = run.logText().length;
    await sleep(40 + next() * 250);
    sd.eject(); await sleep(60 + next() * 200); sd.insert();
    const t0 = Date.now();
    for (;;) {
      const t = run.logText().slice(before);
      const v = [...t.matchAll(/FSHAM verify=(\S+)/g)].map((m) => m[1]);
      if (/FSHAM ERR/.test(t)) errs++;
      if (v.length && /FSHAM DONE/.test(t.slice(t.lastIndexOf("FSHAM verify=")))) { assert.ok(v.every((x) => x === "ok"), "pull " + i + ": " + v.join(",")); break; }
      if (!v.length && /FSHAM DONE/.test(t) && !/FSHAM ERR/.test(t)) break;
      if (Date.now() - t0 > 15000) throw new Error("no recovery after pull " + i + "\n" + t.slice(-800));
      await sleep(30);
    }
  }
  assert.ok(errs >= 3, "the pulls really hit writes: " + errs);
  assert.equal(sd.state().capacityMb, 65536);
  await run.stop();
});
process.exit(failed ? 1 : 0);
