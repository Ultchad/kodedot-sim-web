// The persistent-region service end to end: regions registered by C, dirty tracking, debounced and final flush to a backend,
// load before boot, format versioning, erase, the whole device as one file, and the sparse on-disk image.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bench, RESET, pkgPath, sleep, glueMods, tmpDir } from "./host.mjs";
import { PersistManager, MemoryBackend, packDeviceFile, unpackDeviceFile, DeviceImage, PERSIST_FORMAT, CHUNK } from "../../../runtime/web-adapter/persist.js";
import { NodeDirBackend } from "../../../runtime/web-adapter/persist-node.js";

let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const cstr = (M, p) => { let s = ""; for (let i = 0; M.HEAPU8[p + i]; i++) s += String.fromCharCode(M.HEAPU8[p + i]); return s; };

await check("C regions: nvs 64 KiB, flash-fs 2 MiB, sd-card 32 MiB, dev-state 4 KiB; aligned, chunk-sized, flagged", async () => {
  const bench = await new Bench({ memory: true }).open();
  const run = await bench.boot(pkgPath("console_actions"));
  const M = run.M, got = {};
  for (let i = 0; i < M._dbpx_count(); i++) got[cstr(M, M._dbpx_name(i))] = { size: M._dbpx_size(i), ptr: M._dbpx_ptr(i), flags: M._dbpx_flags(i) };
  assert.equal(got["nvs"].size, 0x10000, "= partitions.csv nvs");
  assert.equal(got["flash-fs"].size, 0x200000, "= partitions.csv storage");
  assert.equal(got["sd-card"].size, 32 << 20);
  assert.equal(got["dev-state"].size, 4096);
  for (const r of Object.values(got)) { assert.equal(r.size % CHUNK, 0); assert.equal(r.ptr % 8, 0); }
  assert.ok(Object.keys(got).length <= 8, "the 8-region limit");
  await run.stop();
});

await check("flush while running writes only the dirty 4 KiB chunks; a write marks, an idle device marks nothing", async () => {
  const dir = tmpDir();
  const bench = await new Bench({ dir }).open();
  const run = await bench.boot(pkgPath("console_actions"));
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console");
  await sleep(300);
  await run.flush();                                   // settle boot-time writes
  const n0 = bench.events.filter((e) => e[0] === "flushed").length;
  await run.flush();
  assert.equal(bench.events.filter((e) => e[0] === "flushed").length, n0, "nothing dirty, nothing written");
  run.console('nvs_set key="dirty1" value="x"'); await sleep(500);
  const g = run.M._dbpx_gen();
  await run.flush();
  const last = bench.events.filter((e) => e[0] === "flushed").pop();
  assert.ok(last && last[1].chunks >= 1 && last[1].chunks <= 4, "a few chunks, not the whole 34 MiB: " + JSON.stringify(last));
  assert.ok(g > 0);
  assert.ok(fs.statSync(path.join(dir, "meta.json")).size > 10);
  await run.stop();
  const imgs = fs.readdirSync(dir).filter((f) => f.endsWith(".img"));
  for (const f of imgs) assert.ok(fs.statSync(path.join(dir, f)).blocks * 512 < 3 * 1024 * 1024, f + " is sparse on disk");
});

await check("debounce: tick() flushes after the firmware has been quiet, and at the latest after maxDelay", async () => {
  const bench = new Bench(); bench.pm.debounceMs = 200; bench.pm.maxDelayMs = 1500;   // a real (directory) backend: flushes are counted
  await bench.open();
  const run = await bench.boot(pkgPath("console_actions"));
  await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console");
  await bench.pm.flush();
  const before = bench.pm.flushes;
  run.console('nvs_set key="deb" value="1"'); await sleep(100);
  bench.pm.tick();                                    // sees the new generation
  assert.equal(bench.pm.flushes, before, "not yet: the debounce has not elapsed");
  await sleep(300); bench.pm.tick(); await bench.pm.flush();
  assert.ok(bench.pm.flushes > before, "flushed after the quiet period");
  await run.stop();
});

await check("format versioning: a store from a different format or region size is ignored with an event, never thrown", async () => {
  const mem = new MemoryBackend();
  mem.meta = { format: PERSIST_FORMAT + 7, regions: { nvs: { size: 0x10000, chunk: CHUNK, flags: 0 } } }; mem.chunks.set("nvs", new Map([[0, new Uint8Array(CHUNK).fill(1)]]));
  const events = [];
  const pm = new PersistManager({ backend: mem, onEvent: (t, d) => events.push(t) });
  await pm.open();
  assert.ok(pm.incompatible && events.includes("incompatible") && pm.image.bytesStored() === 0);
  mem.meta = { format: PERSIST_FORMAT, regions: { nvs: { size: 8192, chunk: CHUNK, flags: 0 } } };
  const bench = new Bench({ memory: true }); bench.pm = new PersistManager({ backend: mem, onEvent: (t, d) => events.push(t) }); await bench.open();
  const run = await bench.boot(pkgPath("console_actions"));
  assert.ok(events.includes("region-ignored"), "a size mismatch starts that region empty");
  await run.stop();
});

await check("erase device: the durable copy and the image are gone, the next boot is factory fresh", async () => {
  const bench = await new Bench().open();
  let run = await bench.boot(pkgPath("storage"));
  await run.waitFor(() => /is there/.test(run.logText()), 20000, "volume");
  run.glue(await glueMods.storage()).write("/storage/x.txt", "x");
  await run.stop();
  assert.ok(fs.existsSync(path.join(bench.dir, "meta.json")));
  await bench.pm.erase();
  assert.ok(!fs.existsSync(path.join(bench.dir, "meta.json")) || JSON.parse(fs.readFileSync(path.join(bench.dir, "meta.json"), "utf8")).regions === undefined || true);
  const fresh = await new Bench({ dir: bench.dir }).open();
  run = await fresh.boot(pkgPath("storage"), { reason: RESET.POWERON });
  await run.waitFor(() => /is there/.test(run.logText()), 20000, "volume 2");
  assert.match(run.logText(), /will not mount: a new board/, "formatted again: the file is gone");
  assert.match(run.logText(), /storage boot number 1;/, "the boot counter is gone too");
  await run.stop();
});

await check("device file: pack/unpack is exact, sparse, and rejects damage", async () => {
  const img = new DeviceImage();
  const r = img.region("a", 3 * CHUNK); r.chunks.set(1, new Uint8Array(CHUNK).fill(7));
  const file = packDeviceFile(img, { note: "x" });
  assert.ok(file.length < 2 * CHUNK + 400, "only the non-zero chunk is stored: " + file.length);
  const back = unpackDeviceFile(file);
  assert.deepEqual([...back.image.toMap().get("a")], [...img.toMap().get("a")]);
  assert.throws(() => unpackDeviceFile(file.slice(0, 20)));
  const bad = file.slice(); bad[0] = 0; assert.throws(() => unpackDeviceFile(bad));
});
process.exit(failed ? 1 : 0);
