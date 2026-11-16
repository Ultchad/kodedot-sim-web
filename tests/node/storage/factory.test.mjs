// First-boot seeding of the internal volume from a package's factory tree (runtime/web-adapter/factory.js, vfs.c seed_locked):
// applied once to a BLANK volume, never to an existing one, not after an explicit format, again after "erase device";
// a package with no tree gets an empty formatted volume; a tree that does not fit or is damaged is reported and harmless.
import assert from "node:assert/strict";
import { Bench, RESET, pkgPath, glueMods } from "../persist/host.mjs";
import { factoryBlob } from "../../../runtime/web-adapter/factory.js";

let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const sm = await glueMods.storage();
const rnd = (n, seed = 1) => { const b = Buffer.alloc(n); let s = seed; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) >>> 0; b[i] = s >>> 24; } return new Uint8Array(b); };
// what the factory/user put there: the example app makes its own folder on every boot, ignore it
const ls = (fs, d = "/storage") => fs.list(d).filter((e) => e.name !== "storage_demo");
const rmrf = (fs, p) => { const st = fs.stat(p); if (st.isDir) { for (const e of fs.list(p)) rmrf(fs, p + "/" + e.name); } fs.remove(p); };
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const tree = (entries) => {            // {path: bytes} -> the archive the host would build from a package
  const files = new Map(), list = [];
  for (const [p, d] of Object.entries(entries)) { files.set("factory/storage/" + p, d); list.push({ path: p, size: d.length }); }
  return factoryBlob(files, { factory: { volume: "storage", files: list } });
};
const A = { "kode/pack.json.z": rnd(300000, 3), "kode/scene2.json.z": rnd(5000, 4), "deep/er/still/file.bin": rnd(777, 5), "empty.txt": new Uint8Array(0), "ünï.txt": new TextEncoder().encode("long names and non-ASCII") };
const boot = async (bench, opts) => {
  const run = await bench.boot(pkgPath("storage"), opts);
  await run.waitFor(() => /is there|storage mounted/.test(run.logText()), 30000, "volume mounted");
  return run;
};

await check("blank device + factory tree: the volume is formatted and populated before the firmware sees it (one log line)", async () => {
  const bench = await new Bench().open();
  const run = await boot(bench, { factory: tree(A) });
  assert.match(run.logText(), /factory content: 5 files, 305801B copied to \/storage/);
  const fs = run.glue(sm);
  for (const [p, d] of Object.entries(A)) assert.ok(eq(fs.read("/storage/" + p), d), p);
  assert.deepEqual(fs.list("/storage/deep/er").map((e) => e.name), ["still"]);
  assert.ok(fs.usage("storage").used >= 305000);
  await run.stop();
});

await check("never overwrites: a restart with a DIFFERENT tree leaves the volume (and a file the user added) as it was", async () => {
  const bench = await new Bench().open();
  let run = await boot(bench, { factory: tree(A) });
  run.glue(sm).write("/storage/mine.txt", "user data");
  run.glue(sm).write("/storage/kode/scene2.json.z", "edited by the user");
  await run.stop();
  run = await boot(bench, { reason: RESET.EXTERNAL, factory: tree({ "kode/scene2.json.z": rnd(10, 9), "new.txt": rnd(10, 8) }) });
  assert.ok(!/factory content:/.test(run.logText()));
  const fs = run.glue(sm);
  assert.equal(fs.readText("/storage/mine.txt"), "user data");
  assert.equal(fs.readText("/storage/kode/scene2.json.z"), "edited by the user");
  assert.equal(fs.stat("/storage/new.txt").exists, false);
  assert.ok(eq(fs.read("/storage/kode/pack.json.z"), A["kode/pack.json.z"]));
  await run.stop();
  // a power cycle too, and a user who deleted everything: an empty volume is still a volume, not a blank one
  run = await boot(bench, { reason: RESET.POWERON, factory: tree(A) });
  const fs2 = run.glue(sm);
  for (const e of fs2.list("/storage")) rmrf(fs2, "/storage/" + e.name);
  assert.deepEqual(fs2.list("/storage"), []);
  await run.stop();
  run = await boot(bench, { reason: RESET.EXTERNAL, factory: tree(A) });
  assert.ok(!/factory content:/.test(run.logText()));
  assert.deepEqual(ls(run.glue(sm)), []);
  await run.stop();
});

await check("an explicit format (page or firmware) means an empty volume: no re-seeding after it, across a restart either", async () => {
  const bench = await new Bench().open();
  let run = await boot(bench, { factory: tree(A) });
  run.glue(sm).format("storage");
  assert.deepEqual(ls(run.glue(sm)), []);
  await run.stop();
  run = await boot(bench, { reason: RESET.EXTERNAL, factory: tree(A) });
  assert.deepEqual(ls(run.glue(sm)), []);
  await run.stop();
});

await check("erase device: the next boot is a blank device again and is seeded again", async () => {
  const bench = await new Bench().open();
  let run = await boot(bench, { factory: tree(A) });
  run.glue(sm).write("/storage/mine.txt", "x");
  await run.stop();
  await bench.pm.erase();
  run = await boot(bench, { reason: RESET.POWERON, factory: tree(A) });
  assert.match(run.logText(), /factory content: 5 files/);
  assert.equal(run.glue(sm).stat("/storage/mine.txt").exists, false);
  assert.ok(eq(run.glue(sm).read("/storage/kode/scene2.json.z"), A["kode/scene2.json.z"]));
  await run.stop();
});

await check("a package with no factory tree: an empty formatted volume, no log line, the firmware is happy", async () => {
  const bench = await new Bench().open();
  const run = await boot(bench, { factory: null });
  assert.ok(!/factory content:/.test(run.logText()));
  const fs = run.glue(sm);
  assert.deepEqual(ls(fs), []);
  assert.equal(fs.usage("storage").total, 2024 * 1024);
  await run.stop();
});

await check("a tree larger than the volume: reported with errors, what fitted is there, the device boots", async () => {
  const bench = await new Bench().open();
  const run = await boot(bench, { factory: tree({ "a.bin": rnd(1000000, 1), "b.bin": rnd(1000000, 2), "c.bin": rnd(1000000, 3), "d.txt": rnd(100, 4) }) });
  assert.match(run.logText(), /factory content: \d+ files, \d+B copied to \/storage \(with errors\)/);
  assert.ok(run.glue(sm).stat("/storage/a.bin").exists);
  assert.ok(!/assert|panic/i.test(run.logText().replace(/assert hook installed/g, "")));
  await run.stop();
});

await check("a damaged archive (truncated, or a path of 0 bytes) stops the seeding at the damage, with an error, and never reads past the end", async () => {
  const good = tree(A);
  for (const bad of [good.subarray(0, 1000), new Uint8Array([0, 0, 5, 0, 0, 0, 1, 2, 3, 4, 5]), good.subarray(0, 5)]) {
    const bench = await new Bench().open();
    const run = await boot(bench, { factory: bad });
    assert.ok(run.restartRequested() === false);
    assert.ok(/factory content:.*with errors/.test(run.logText()) || !/factory content:/.test(run.logText()), run.logText().slice(-300));
    await run.stop();
  }
});

console.log(failed ? "factory: FAILED" : "factory: PASSED");
process.exit(failed ? 1 : 0);
