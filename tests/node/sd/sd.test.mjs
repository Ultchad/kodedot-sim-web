// microSD as a second volume: a virtual card that is inserted and removed at run time, has a selectable capacity and its own
// region, is FAT formatted, and behaves defined when pulled (idle or mid-write).
import assert from "node:assert/strict";
import path from "node:path";
import { Bench, RESET, pkgPath, sleep, glueMods, appProject, assembleApp, buildApp } from "../persist/host.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
async function cli(run, line, ms = 6000) {
  const start = run.logText().length;
  run.console(line);
  const t0 = Date.now();
  for (;;) {
    const t = strip(run.logText().slice(start));
    const m = /^>(ok|err .*)$/m.exec(t);
    if (m) return { ok: m[1] === "ok", text: t, lines: t.split("\n").filter((l) => l.startsWith(">|")) };
    if (Date.now() - t0 > ms) throw new Error("no reply to: " + line + "\n" + t);
    await sleep(25);
  }
}
/** `sd_mount` answers >ok at once and mounts in AO_Storage: wait until the card says it is mounted (or that it will not be). */
async function mountCard(run, sd, ms = 8000) {
  const mark = run.logText().length;
  const r = await cli(run, "sd_mount");
  const t0 = Date.now();
  while (!sd.state().mounted && Date.now() - t0 < ms && !/no FAT volume|stays unmounted|no card/.test(run.logText().slice(mark))) await sleep(30);
  return { ...r, mounted: sd.state().mounted };
}
const code = (fn) => { try { fn(); return "none"; } catch (e) { return e.code ?? e.message; } };
const sm = await glueMods.storage(), sdm = await glueMods.sd();

await check("idle: mount, files, pull the card, I/O fails and the card is not mounted, put it back, mount again, data intact", async () => {
  const bench = await new Bench().open();
  const run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /kode>/.test(run.logText()) && /is there/.test(run.logText()), 20000, "console");
  const fs = run.glue(sm), sd = run.glue(sdm);
  const events = [];
  const ctx = sd; void ctx;
  assert.deepEqual({ ...sd.state(), serial: 0, generation: 0 }, { inserted: true, capacityMb: 8, serial: 0, writeProtect: false, generation: 0, mounted: false });
  assert.equal(code(() => fs.list("/sdcard")), "ENODEV", "nothing mounted yet");
  let r = await mountCard(run, sd);
  assert.equal(r.mounted, true, "factory card is FAT formatted and mounts");
  assert.match((await cli(run, "sd_info")).text, /(8|7)\d* ?MB|capacity|sectors/i);
  assert.ok((await cli(run, 'write path="/sdcard/note.txt" text="on the card"')).ok);
  assert.ok((await cli(run, 'mkdir path="/sdcard/dir"')).ok);
  assert.equal(fs.readText("/sdcard/note.txt"), "on the card");
  const u = fs.usage("sdcard");
  assert.ok(u.total > 7 * 1024 * 1024 && u.total <= 8 * 1024 * 1024 && u.free < u.total, JSON.stringify(u));
  // pull it
  sd.eject();
  assert.equal(sd.state().inserted, false); assert.equal(sd.state().mounted, false, "an absent card is not mounted");
  assert.equal(code(() => fs.read("/sdcard/note.txt")), "ENODEV");
  assert.match((await cli(run, 'cat path="/sdcard/note.txt"')).text, /err/);
  assert.match((await cli(run, 'write path="/sdcard/x.txt" text="nope"')).text, /err/);
  assert.equal((await mountCard(run, sd, 1500)).mounted, false, "no card, no mount");
  // the internal volume is unaffected
  assert.ok((await cli(run, 'write path="/storage/still.txt" text="fine"')).ok);
  // put it back: not mounted until mounted
  sd.insert();
  assert.equal(sd.state().inserted, true); assert.equal(sd.state().mounted, false, "inserting does not mount: the firmware mounts, as on the board");
  assert.equal((await mountCard(run, sd)).mounted, true);
  assert.equal(fs.readText("/sdcard/note.txt"), "on the card", "the card kept its data");
  assert.deepEqual(fs.list("/sdcard").map((e) => e.name).sort(), ["dir", "note.txt"]);
  // write protect
  sd.setWriteProtect(true);
  assert.equal(code(() => fs.write("/sdcard/wp.txt", "x")), "EROFS");
  sd.setWriteProtect(false);
  fs.write("/sdcard/wp.txt", "x");
  await run.stop();
});

await check("capacity is selectable (2 MB..256 GB; small cards here), a new card is blank or FAT formatted, and the card has its own region", async () => {
  const bench = await new Bench().open();
  const run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /kode>/.test(run.logText()) && /is there/.test(run.logText()), 20000, "console");
  const fs = run.glue(sm), sd = run.glue(sdm);
  const serial0 = sd.state().serial;
  for (const mb of [2, 16, 32]) {
    sd.swap(mb);
    assert.equal(sd.state().capacityMb, mb); assert.notEqual(sd.state().serial, serial0);
    assert.equal((await mountCard(run, sd)).mounted, true);
    const u = fs.usage("sdcard");
    assert.ok(u.total > (mb - 1) * 1024 * 1024 * 0.9 && u.total <= mb * 1024 * 1024, mb + " MB card: " + JSON.stringify(u));
    fs.write("/sdcard/c.bin", new Uint8Array(100000).fill(mb));
    await cli(run, "sd_unmount"); await sleep(200);
  }
  assert.throws(() => sd.swap(1)); assert.throws(() => sd.swap(262145));   // the range is 2 MB .. 256 GB since the sparse card (sd/bigsd.test.mjs)
  sd.swap(4, { format: false });                             // a blank card: no FAT
  assert.equal((await mountCard(run, sd, 3000)).mounted, false);
  assert.match(run.logText(), /card has no FAT volume/);
  const names = new Set(); for (let i = 0; i < bench.pm.image.regions.size; i++) void i;
  assert.ok(bench.pm.image.regions.has("sd-card") && bench.pm.image.regions.has("flash-fs") && bench.pm.image.regions.has("nvs"), "separate regions: " + [...bench.pm.image.regions.keys()]);
  await run.stop();
});

await check("the card and its files survive a restart and the power being cut (a new Bench over the same directory)", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /kode>/.test(run.logText()) && /is there/.test(run.logText()), 20000, "console");
  let fs = run.glue(sm), sd = run.glue(sdm);
  sd.swap(12);
  assert.equal((await mountCard(run, sd)).mounted, true);
  fs.write("/sdcard/persist.txt", "still here");
  sd.setWriteProtect(false);
  await run.stop();
  const again = await new Bench({ dir: bench.dir }).open();
  run = await again.boot(pkgPath("storage"), { reason: RESET.POWERON });
  await run.waitFor(() => /kode>/.test(run.logText()) && /is there/.test(run.logText()), 20000, "console 2");
  fs = run.glue(sm); sd = run.glue(sdm);
  assert.equal(sd.state().capacityMb, 12, "capacity and serial are part of the device");
  assert.equal((await mountCard(run, sd)).mounted, true);
  assert.equal(fs.readText("/sdcard/persist.txt"), "still here");
  await run.stop();
});

// Pulled mid-write: a hammer app writes files to /sdcard forever; the page pulls the card at random moments and puts it back.
const name = "sd_hammer";
const pkg = buildApp(assembleApp(name, appProject(name, [name + "_main.c"], {
  ["main/" + name + "_main.c"]: { copy: path.join(here, "../storage/apps", name, "main", name + "_main.c") },
  "main/fs_hammer.h": { copy: path.join(here, "../storage/apps/fs_hammer/main/fs_hammer.h") } })));
await check("pulled mid-write 25 times: the firmware sees errors, remounts after re-insert, earlier files are intact every time", async () => {
  const bench = await new Bench().open();
  const run = await bench.boot(pkg);
  await run.waitFor(() => /FSHAM DONE 3\b/.test(run.logText()), 30000, "hammer writing to the card");
  const sd = run.glue(sdm);
  let errs = 0, rnd = 12345;
  const next = () => (rnd = (rnd * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 25; i++) {
    const before = run.logText().length;
    await sleep(40 + next() * 250);
    sd.eject();
    await sleep(60 + next() * 200);
    assert.equal(sd.state().mounted, false);
    sd.insert();
    // the firmware remounts on its own (the hammer retries); it must come back with a clean verify
    const t0 = Date.now();
    for (;;) {
      const t = run.logText().slice(before);
      const v = [...t.matchAll(/FSHAM verify=(\S+)/g)].map((m) => m[1]);
      if (/FSHAM ERR/.test(t)) errs++;
      if (v.length && /FSHAM DONE/.test(t.slice(t.lastIndexOf("FSHAM verify=")))) { assert.ok(v.every((x) => x === "ok"), "pull " + i + ": " + v.join(",")); break; }
      if (!v.length && /FSHAM DONE/.test(t) && !/FSHAM ERR/.test(t)) break;      // pulled between two files: nothing was in flight
      if (Date.now() - t0 > 15000) throw new Error("no recovery after pull " + i + "\n" + t.slice(-800));
      await sleep(30);
    }
  }
  assert.ok(errs >= 5, "the pulls really hit writes: " + errs);
  await run.stop();
});
process.exit(failed ? 1 : 0);
