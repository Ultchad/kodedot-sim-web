// The page-side file API (storage.js) against a running device: create, read, write, append, offset write, truncate,
// rename, delete, directories, list, free/used space, error codes, a volume filled to capacity, and use while the firmware
// is writing the same volume. Also the device-file round trip (export a device, import it into a fresh one, compare).
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { Bench, RESET, pkgPath, sleep, glueMods, appProject, assembleApp, buildApp } from "../persist/host.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const sm = await glueMods.storage();
const code = (fn) => { try { fn(); return "none"; } catch (e) { return e.code ?? e.message; } };
const rnd = (n, seed = 1) => { const b = Buffer.alloc(n); let s = seed; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; b[i] = s >>> 24; } return new Uint8Array(b); };
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

await check("files: create, read, write, append, offset write, truncate, rename, delete, dirs, list, usage, errors", async () => {
  const bench = await new Bench().open();
  const run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /is there/.test(run.logText()), 20000, "volume");
  const fs = run.glue(sm);
  const u0 = fs.usage("storage");
  assert.equal(u0.total, 2024 * 1024, "2 MiB partition minus FAT metadata");
  assert.ok(u0.free > 2000 * 1024 && u0.free <= u0.total);

  fs.mkdir("/storage/a/b/c", { parents: true });
  assert.deepEqual(fs.list("/storage/a").map((e) => [e.name, e.type]), [["b", "dir"]]);
  fs.write("/storage/a/t.txt", "hello");
  assert.equal(fs.readText("/storage/a/t.txt"), "hello");
  fs.write("/storage/a/t.txt", " world", { append: true });
  assert.equal(fs.readText("/storage/a/t.txt"), "hello world");
  fs.write("/storage/a/t.txt", "J", { offset: 0 });
  assert.equal(fs.readText("/storage/a/t.txt"), "Jello world");
  fs.write("/storage/a/t.txt", "new");                       // replace
  assert.equal(fs.readText("/storage/a/t.txt"), "new");
  const big = rnd(300000, 7);                                // several 63 KiB chunks
  fs.write("/storage/a/big.bin", big);
  assert.deepEqual(fs.stat("/storage/a/big.bin"), { exists: true, isDir: false, size: 300000 });
  assert.ok(eq(fs.read("/storage/a/big.bin"), big));
  assert.ok(eq(fs.read("/storage/a/big.bin", { offset: 12345, length: 70000 }), big.subarray(12345, 82345)));
  fs.truncate("/storage/a/big.bin", 1000);
  assert.ok(eq(fs.read("/storage/a/big.bin"), big.subarray(0, 1000)));
  fs.truncate("/storage/a/big.bin", 3000);                   // grow: zero filled
  const grown = fs.read("/storage/a/big.bin");
  assert.equal(grown.length, 3000); assert.ok(grown.subarray(1000).every((x) => x === 0));
  fs.rename("/storage/a/big.bin", "/storage/a/b/moved.bin");
  assert.equal(fs.stat("/storage/a/big.bin").exists, false);
  assert.equal(fs.stat("/storage/a/b/moved.bin").size, 3000);
  const names = fs.list("/storage/a").map((e) => e.name).sort();
  assert.deepEqual(names, ["b", "t.txt"]);
  // long name, mixed case, spaces (LFN)
  fs.write("/storage/a/A Long File Name With Spaces.TXT", "x");
  assert.ok(fs.list("/storage/a").some((e) => e.name === "A Long File Name With Spaces.TXT"));
  // errors
  assert.equal(code(() => fs.read("/storage/nope")), "ENOENT");
  assert.equal(code(() => fs.mkdir("/storage/a")), "EEXIST");
  assert.equal(code(() => fs.mkdir("/storage/a/t.txt/x")), "ENOTDIR");
  assert.equal(code(() => fs.write("/storage/a", "x")), "EISDIR");
  assert.equal(code(() => fs.read("/storage/a")), "EISDIR");
  assert.equal(code(() => fs.remove("/storage/a")), "ENOTEMPTY");
  assert.equal(code(() => fs.remove("/storage/nope")), "ENOENT");
  assert.equal(code(() => fs.rename("/storage/a/t.txt", "/storage/a/A Long File Name With Spaces.TXT")), "EEXIST", "FAT does not replace on rename");
  assert.equal(code(() => fs.rename("/storage/a/t.txt", "/sdcard/t.txt")), "EXDEV");
  assert.equal(code(() => fs.list("/storage/a/t.txt")), "ENOTDIR");
  // used space moves, and delete gives it back
  const u1 = fs.usage("storage");
  assert.ok(u1.free < u0.free && u1.used > 0);
  fs.remove("/storage/a/A Long File Name With Spaces.TXT"); fs.remove("/storage/a/t.txt"); fs.remove("/storage/a/b/moved.bin");
  fs.remove("/storage/a/b/c"); fs.remove("/storage/a/b"); fs.remove("/storage/a");
  assert.equal(fs.usage("storage").free, u0.free, "everything given back");
  await run.stop();
});

await check("a volume filled to capacity: ENOSPC, nothing damaged, space comes back, survives a restart", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /is there/.test(run.logText()), 20000, "volume");
  let fs = run.glue(sm);
  fs.mkdir("/storage/fill");
  const files = [];
  let enospc = null;
  for (let i = 0; i < 100; i++) {
    const data = rnd(60000 + i, 100 + i);
    try { fs.write(`/storage/fill/f${i}.bin`, data); files.push([i, data]); }
    catch (e) { enospc = e; try { fs.remove(`/storage/fill/f${i}.bin`); } catch { /* partial file */ } break; }
  }
  assert.ok(enospc && enospc.code === "ENOSPC", "the volume reported ENOSPC: " + enospc?.code);
  assert.ok(files.length >= 30 && files.length <= 36, "about 2 MiB / 60 KB files: " + files.length);
  assert.ok(fs.usage("storage").free < 65000, "full (less than one more file): " + fs.usage("storage").free);
  for (const [i, d] of files) assert.ok(eq(fs.read(`/storage/fill/f${i}.bin`), d), "file " + i + " intact when full");
  // the SDK path reports it too: the example's top button appends a line to a full volume
  run.button(4, true); await sleep(80); run.button(4, false);
  await run.waitFor(() => /write failed|write not taken|could not|line written/.test(run.logText()), 6000, "firmware write on a full volume");
  fs.remove("/storage/fill/f0.bin");
  fs.write("/storage/fill/again.bin", rnd(50000, 5));        // room again
  assert.ok(eq(fs.read("/storage/fill/again.bin"), rnd(50000, 5)));
  await run.stop();
  run = await bench.boot(pkgPath("storage"), { reason: RESET.EXTERNAL });
  await run.waitFor(() => /is there/.test(run.logText()), 20000, "volume 2");
  fs = run.glue(sm);
  for (const [i, d] of files.slice(1, 6)) assert.ok(eq(fs.read(`/storage/fill/f${i}.bin`), d), "file " + i + " after restart");
  assert.ok(eq(fs.read("/storage/fill/again.bin"), rnd(50000, 5)));
  await run.stop();
});

await check("the page can use the volume while the firmware writes it (same lock): no torn reads of finished files", async () => {
  const name = "fs_hammer";
  const pkg = buildApp(assembleApp(name, appProject(name, [name + "_main.c"], {
    ["main/" + name + "_main.c"]: { copy: path.join(here, "apps", name, "main", name + "_main.c") },
    "main/fs_hammer.h": { copy: path.join(here, "apps/fs_hammer/main/fs_hammer.h") } })));
  const bench = await new Bench().open();
  const run = await bench.boot(pkg);
  await run.waitFor(() => /FSHAM DONE 5\b/.test(run.logText()), 20000, "hammer running");
  const fs = run.glue(sm);
  let reads = 0, busy = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 2500) {
    for (const e of fs.list("/storage/h")) {
      try {
        const b = fs.read("/storage/h/" + e.name);
        reads++;
        // a file that is complete (its header's length equals its size) must hold exactly the pattern
        const dv = Buffer.from(b);
        if (b.length >= 9 && dv[0] === 0x47 && dv.readUInt32LE(5) === b.length) {
          const g = dv.readUInt32LE(1);
          for (let i = 9; i < b.length; i++) if (b[i] !== ((g * 31 + i * 7 + (i >> 8)) & 255)) throw new Error("torn read in " + e.name + " at " + i);
        }
      } catch (err) { if (err.code === "EBUSY") busy++; else if (err.code !== "ENOENT") throw err; }
    }
    fs.usage("storage");
    await sleep(1);
  }
  assert.ok(reads > 50, "page reads happened: " + reads);
  await run.stop();
});

await check("export a device to one file, import it into a fresh device, compare: NVS, files, SD, clock", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("console_actions"));
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console");
  run.console('nvs_set key="exp1" value="exported"'); await sleep(400);
  const fs = run.glue(sm), sd = run.glue(await glueMods.sd()), tm = run.glue(await glueMods.time());
  fs.write("/storage/export.txt", "in the file");
  sd.mount(); fs.write("/sdcard/card.txt", "on the card");
  tm.set(Date.UTC(2031, 0, 2, 3, 4, 5));
  await run.stop();
  const file = bench.pm.exportDeviceFile({ note: "t" });
  assert.ok(file.length > 100 && file.length < 3 * 1024 * 1024, "sparse: " + file.length);

  const other = await new Bench({ memory: true }).open();
  other.pm.importDeviceFile(file);
  const a = bench.pm.exportMap(), b = other.pm.exportMap();
  assert.deepEqual([...b.keys()].sort(), [...a.keys()].sort());
  for (const [k, v] of a) assert.ok(eq(v, b.get(k)), "region " + k + " identical");
  const run2 = await other.boot(pkgPath("storage"), { reason: RESET.POWERON });
  await run2.waitFor(() => /is there/.test(run2.logText()), 20000, "volume");
  const fs2 = run2.glue(sm), sd2 = run2.glue(await glueMods.sd()), tm2 = run2.glue(await glueMods.time());
  assert.equal(fs2.readText("/storage/export.txt"), "in the file");
  sd2.mount(); assert.equal(fs2.readText("/sdcard/card.txt"), "on the card");
  assert.ok(Math.abs(tm2.now() - Date.UTC(2031, 0, 2, 3, 4, 5)) < 60000, "the device clock came along");
  const nv = run2.glue(await glueMods.nvs());
  assert.ok(nv.list().some((e) => e.key.includes("exp1")), "the setting came along: " + JSON.stringify(nv.list()));
  await run2.stop();
});
process.exit(failed ? 1 : 0);
