// The host half of the apps region, no firmware: the directory (A/B, generation, CRC), the allocator and FIFO eviction, the 64-entry
// limit, and the bootloader's request state machine with its keep list. The firmware's REAL kdrv_apps.c reading these bytes is proved
// by boot.boot-test.mjs (kodeOS boots on a region built here).
import assert from "node:assert/strict";
import { PersistManager } from "../../../runtime/web-adapter/persist.js";
import { AppsFlash, AppsRegion, K, ROM, APPS_SIZE, crc32le, decodeDir, encodeDir, planInstall, synthImage, walkImage, describeImage, tryBootRequestedApp, causeKeeps } from "../../../runtime/web-adapter/kapps.js";

let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const fresh = () => { const pm = new PersistManager(); const r = new AppsRegion(new AppsFlash(pm)); return { pm, r, kind: r.load() }; };
const img = (n, extra = 0) => { const b = synthImage({ project: "app" + n, version: "1." + n, name: "App " + n, buildId: new Uint8Array(32).fill(n) }); if (!extra) return b; const o = new Uint8Array(extra); o.set(b); return o; };

await check("crc32le is the ROM's (init UINT32_MAX = plain CRC-32 from zero)", () => {
  assert.equal(crc32le(0xffffffff, new TextEncoder().encode("123456789")), 0xd202d277);
});
await check("a blank region is formatted (gen 1, copy A), copy B stays erased", () => {
  const { r, kind } = fresh();
  assert.equal(kind, "formatted"); assert.equal(r.dir.gen, 1); assert.equal(r.dir.count, 0); assert.equal(r.active, K.DIR_A_OFF);
  assert.equal(new AppsFlash(r.flash.pm).read(K.DIR_B_OFF, 4).join(), "255,255,255,255");
  const again = new AppsRegion(r.flash); assert.equal(again.load(), "ok");
});
await check("install: image is verified, directory commits alternate A/B with generation +1, entries are 64 KB aligned, in install order", () => {
  const { r } = fresh();
  r.install(img(1)); const g1 = r.dir.gen, a1 = r.active;
  r.install(img(2));
  assert.equal(r.dir.gen, g1 + 1); assert.notEqual(r.active, a1);
  const l = r.list();
  assert.deepEqual(l.map((a) => a.project), ["app1", "app2"]);
  assert.ok(l.every((a) => a.offset % K.ALIGN === 0 && a.offset >= K.DATA_OFF));
  assert.deepEqual(l.map((a) => a.seq), [1, 2]);
  assert.equal(l[0].name, "App 1");
  const reload = new AppsRegion(r.flash); assert.equal(reload.load(), "ok"); assert.equal(reload.list().length, 2);
});
await check("a torn directory write: the other copy wins; the magic is written last", () => {
  const { pm, r } = fresh();
  r.install(img(1));
  const before = r.list().length, active = r.active, other = active === K.DIR_A_OFF ? K.DIR_B_OFF : K.DIR_A_OFF;
  // simulate a cut after the body of the next commit but before its magic: erase the inactive sector, program everything but the first word
  const d = { gen: r.dir.gen + 1, count: 0, e: [] }; const b = encodeDir(d);
  r.flash.erase(other, K.SECTOR); r.flash.program(other + 4, b.subarray(4));
  const re = new AppsRegion(new AppsFlash(pm)); assert.equal(re.load(), "ok");
  assert.equal(re.list().length, before, "the whole copy (higher-generation torn one ignored) still serves");
});
await check("same project installs again: it replaces its namesake", () => {
  const { r } = fresh();
  r.install(img(1)); r.install(img(2)); r.install(img(1));
  assert.deepEqual(r.list().map((a) => a.project), ["app2", "app1"]);
});
await check("remove: entry gone, header erased", () => {
  const { r } = fresh();
  r.install(img(1)); const off = r.list()[0].offset;
  assert.ok(r.remove("app1")); assert.equal(r.list().length, 0);
  assert.equal(r.flash.read(off, 4).join(), "255,255,255,255");
  assert.equal(r.remove("app1"), false);
});
await check("allocator: next fit after the newest, wraps, evicts the oldest (FIFO) when nothing fits", () => {
  const free = APPS_SIZE - K.DATA_OFF;
  const d = { gen: 1, count: 0, e: [] };
  assert.equal(planInstall(d, APPS_SIZE, 100)?.offset, K.DATA_OFF);
  assert.equal(planInstall(d, APPS_SIZE, free + 1), null, "bigger than an empty region");
  // three apps of 1.5 MiB: the third does not fit behind (4 MiB region): first goes
  const mk = (i, off, size) => ({ offset: off, size, seq: i, flags: 1 });
  d.e = [mk(1, K.DATA_OFF, 0x180000), mk(2, K.DATA_OFF + 0x180000, 0x180000)]; d.count = 2;
  const p = planInstall(d, APPS_SIZE, 0x180000);
  assert.deepEqual(p.evict, [0]); assert.equal(p.offset, K.DATA_OFF);
});
await check("64 entries: the 65th install takes the oldest entry's place; every app is whole", () => {
  const { r } = fresh();
  for (let i = 1; i <= 64; i++) r.install(img(i % 250 + 1, 0), i);
  assert.equal(r.list().length, 64);
  const res = r.install(synthImage({ project: "extra", version: "9", name: "Extra", buildId: new Uint8Array(32).fill(7) }));
  assert.equal(r.list().length, 64);
  assert.equal(res.evicted.length, 1);
  assert.ok(!r.findProject(res.evicted[0]) && r.findProject("extra"));
  for (const a of r.list()) assert.ok(walkImage(r.flash.read(a.offset, a.size)));
});
await check("boot request: NEW boots once (-> TRIED), ALWAYS arms (-> ARMED) and survives the keep list, anything else retires it", () => {
  const { r } = fresh();
  r.install(img(1)); const a = r.list()[0];
  r.writeReq(a.offset, a.size, K.STATE.NEW);
  let hit = tryBootRequestedApp(r, ROM.CPU_SW);
  assert.equal(hit.project, "app1"); assert.equal(r.readReq().state, K.STATE.TRIED);
  assert.equal(tryBootRequestedApp(r, ROM.CPU_SW), null, "a TRIED request is not live: kodeOS boots (and reads FROM_APP)");
  r.writeReq(a.offset, a.size, K.STATE.ALWAYS);
  assert.ok(tryBootRequestedApp(r, ROM.POWERON)); assert.equal(r.readReq().state, K.STATE.ARMED);
  for (const c of [ROM.CORE_SW, ROM.DEEP_SLEEP, ROM.CPU_SW, ROM.USB_JTAG, ROM.USB_UART, ROM.CPU_JTAG]) { assert.ok(causeKeeps(c)); assert.ok(tryBootRequestedApp(r, c), "kept by 0x" + c.toString(16)); assert.equal(r.readReq().state, K.STATE.ARMED); }
  assert.equal(tryBootRequestedApp(r, ROM.CPU_SW, true), null, "a full mailbox gives an armed sketch way");
  assert.equal(r.readReq().state, K.STATE.TRIED);
  r.writeReq(a.offset, a.size, K.STATE.ALWAYS); tryBootRequestedApp(r, ROM.CPU_SW);
  assert.equal(tryBootRequestedApp(r, ROM.POWERON), null, "power-on (BOT+LEFT) retires it"); assert.equal(r.readReq().state, K.STATE.TRIED);
  assert.equal(tryBootRequestedApp(r, ROM.WDT), null);
});
await check("boot request: bad geometry, bad CRC and a bad image never boot (a bad image is retired to TRIED)", () => {
  const { r } = fresh();
  assert.throws(() => r.writeReq(0x1000, 10, K.STATE.NEW)); assert.throws(() => r.writeReq(K.DATA_OFF + 5, 10, K.STATE.NEW));
  assert.throws(() => r.writeReq(K.DATA_OFF, 10, K.STATE.ARMED));
  r.writeReq(K.DATA_OFF, 100, K.STATE.NEW);          // nothing installed there: the image does not verify
  assert.equal(tryBootRequestedApp(r, ROM.CPU_SW), null); assert.equal(r.readReq().state, K.STATE.TRIED);
  r.writeReq(K.DATA_OFF, 100, K.STATE.NEW); r.flash.program(K.REQ_OFF + 4, new Uint8Array([0]));   // flip a bit of the offset: CRC fails
  assert.equal(tryBootRequestedApp(r, ROM.CPU_SW), null);
});
await check("a directory of another version is left alone (foreign), never formatted over", () => {
  const { r } = fresh();
  const b = encodeDir({ gen: 5, count: 0, e: [] }); new DataView(b.buffer).setUint32(4, 2, true);
  r.flash.erase(K.DIR_A_OFF, K.SECTOR); r.flash.program(K.DIR_A_OFF, b);
  const re = new AppsRegion(r.flash); assert.equal(re.load(), "foreign");
});
process.exit(failed ? 1 : 0);
