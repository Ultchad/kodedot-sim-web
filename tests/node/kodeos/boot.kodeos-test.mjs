// kodeOS boots under Node on a simulated device with persistence, reaches its lock screen (the face, with Kody drawn by
// ThorVG/Lottie from the pack that was seeded onto the real internal FAT volume), a swipe takes it to the launcher
// (empty state), and then the device keeps what it was given across restarts:
//   boot 1  blank device: the volume is formatted and populated from the package's factory tree; a setting is written
//   boot 2  restart: the volume is NOT seeded again, the pack is read from the volume, the setting is still there
//   boot 3  after "erase device": blank again, seeded again, the setting is gone
//   tests/node/kodeos/run.sh        (builds the OS package first; named *.kodeos-test.mjs so tests/node/run.sh does not
//                                    pick it up: see docs/STATUS-kodeos.md)
import assert from "node:assert/strict";
import { Bench, OFF, RESET, sleep } from "../persist/host.mjs";
import { pkgPath } from "../harness.mjs";
import { savePng } from "./png.mjs";
import path from "node:path";
import fs from "node:fs";

const pkg = pkgPath("kodeos");
const shotDir = process.env.KODEOS_SHOTS;      // optional: save PNGs of the milestones there
let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};
const distinctColours = (fb) => { const s = new Set(); for (let i = 0; i < fb.length; i += 4) s.add((fb[i] | (fb[i + 1] << 8) | (fb[i + 2] << 16)) >>> 0); return s.size; };
const litPixels = (fb) => { let n = 0; for (let i = 0; i < fb.length; i += 4) if (fb[i] | fb[i + 1] | fb[i + 2]) n++; return n / (fb.length / 4); };
const band = (a, fb, y0, y1) => Buffer.from(fb.subarray(y0 * a.u32(OFF.fbStride), y1 * a.u32(OFF.fbStride)));
const shot = (a, name) => { if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); savePng(path.join(shotDir, name), a.framebuffer(), a.u32(OFF.fbW), a.u32(OFF.fbH), a.u32(OFF.fbStride)); } };
const swipeLeft = async (a) => {
  for (let x = 360; x >= 40; x -= 40) { a.touch(x, 300, true); await sleep(40); }
  a.touch(40, 300, false);
};
const ZONE = "<-03>3";

const bench = await new Bench().open();

// ------------------------------------------------------------------------------------------------ boot 1: a new device
const a = await bench.boot(pkg, { reason: RESET.POWERON });

await check("boots, the real AOs come up and the first frame is drawn", async () => {
  await a.waitFor(() => a.logText().includes("kgui first frame"), 60000, "kgui first frame");
  const t = a.logText();
  for (const s of ["kaos.storage up", "kaos.ioexp up", "kaos.buttons up", "kaos.display up at 100%", "kaos.ledmgr up", "kcli console up"])
    assert.ok(t.includes(s), "missing log line: " + s);
  assert.equal(a.u32(OFF.panelOn), 1);
  assert.equal(a.u32(OFF.fbW), 410);
  assert.equal(a.u32(OFF.fbH), 502);
});

await check("a blank device: the internal volume is formatted and filled from the package's factory tree, once", async () => {
  const t = a.logText();
  assert.match(t, /kdrv\.fs.*factory content: \d+ files, \d+B copied to \/storage/);
  assert.equal(t.match(/factory content:/g).length, 1);
  assert.ok(!/with errors/.test(t), "errors while seeding");
});

await check("Kody's pack is read from the volume and inflated (no 'do not inflate' warning)", async () => {
  await a.waitFor(() => a.logText().includes("kgui assets: source=fat"), 20000, "pack read from the FAT");
  await a.waitFor(() => a.logText().includes("kgui face: drew "), 20000, "face scene drawn");
  assert.ok(!a.logText().includes("do not inflate"), a.logText());
});

await check("the factory tree is really on the volume, as the page's file API sees it", async () => {
  const { default: storage } = await import("../../../runtime/drivers/storage/storage.js");
  const { glueCtx } = await import("../persist/host.mjs");
  const fsApi = storage(glueCtx(a.M));
  const kode = fsApi.list("/storage/kode");
  assert.ok(kode.length > 0 && kode.some((f) => /\.json\.z$/.test(f.name)), "no pack in /storage/kode: " + JSON.stringify(kode));
  const u = fsApi.usage("storage");
  assert.ok(u.used > 300 * 1024 && u.used < 1024 * 1024, "volume use: " + JSON.stringify(u));
});

await check("lock screen: a non-trivial framebuffer (clock, pill, Kody)", async () => {
  await sleep(1500);
  const fb = a.framebuffer();
  assert.ok(distinctColours(fb) > 8, "distinct colours: " + distinctColours(fb));
  assert.ok(litPixels(fb) > 0.2, "lit fraction: " + litPixels(fb));
  shot(a, "lock-screen.png");
});

await check("lock screen is stable: the clock band never changes, the glass is never declared lost, frames keep coming", async () => {
  const seq0 = a.frameSeq();
  const clock0 = band(a, a.framebuffer(), 30, 190);
  await sleep(700);
  const clock1 = band(a, a.framebuffer(), 30, 190);
  await sleep(700);
  const clock2 = band(a, a.framebuffer(), 30, 190);
  // the time is shown to the minute: tolerate exactly one rollover between samples
  assert.ok(clock0.equals(clock1) || clock1.equals(clock2), "clock band changed twice in 1.4 s");
  assert.ok(a.frameSeq() > seq0, "no frames flushed");
  const t = a.logText();
  assert.ok(!t.includes("the glass is lost"), "AO_Display declared the glass lost");
  assert.ok(!a.restartRequested(), "the firmware asked for a restart");
  assert.ok(!/assert(ion)? failed|panic|abort\(\)|Guru Meditation/i.test(t), "assert/panic in the log");
});

await check("a swipe left on the face opens the launcher: empty state, no apps", async () => {
  const before = a.framebuffer();
  await swipeLeft(a);
  await a.waitFor(() => a.logText().includes("kgui empty launcher"), 15000, "'kgui empty launcher'");
  await sleep(1500);
  const fb = a.framebuffer();
  assert.ok(!Buffer.from(before).equals(Buffer.from(fb)), "framebuffer unchanged");
  assert.ok(distinctColours(fb) > 6, "distinct colours: " + distinctColours(fb));
  assert.ok(!a.restartRequested());
  shot(a, "launcher-empty.png");
});

await check("a setting written in this boot (the time zone) is stored", async () => {
  assert.ok(!a.logText().includes(ZONE), "the zone was there on a blank device");
  a.console(`config key="zone" value="${ZONE}"`);
  await a.waitFor(() => a.logText().includes("zone: " + ZONE + " (stored)"), 15000, "zone stored");
});
await a.flush();
await a.stop();

// ------------------------------------------------------------------------------------------------ boot 2: a restart
const b = await bench.boot(pkg, { reason: RESET.EXTERNAL });
await check("restart: the volume is not seeded again and the pack is read from it", async () => {
  await b.waitFor(() => b.logText().includes("kgui first frame"), 60000, "kgui first frame");
  await b.waitFor(() => b.logText().includes("kgui assets: source=fat"), 20000, "pack read from the FAT");
  assert.ok(!b.logText().includes("factory content:"), "the factory tree was applied to an existing volume");
  assert.match(b.logText(), /storage mounted at \/storage/);
});
await check("restart: the setting written in the previous boot is there (AO_Boot loads it from NVS at boot, before any command)", async () => {
  assert.match(b.logText(), new RegExp("zone: " + ZONE.replace(/[<>]/g, "\\$&") + " \\(stored\\)"), "AO_Boot did not find the stored zone");
  const n0 = b.logText().split(ZONE).length;
  b.console(`config key="zone"`);
  await b.waitFor(() => b.logText().split(ZONE).length > n0, 15000, "`config key=\"zone\"` answers with the stored zone");
});
await check("restart: a file the user put on the volume survived next to the factory tree", async () => {
  const { default: storage } = await import("../../../runtime/drivers/storage/storage.js");
  const { glueCtx } = await import("../persist/host.mjs");
  const fsApi = storage(glueCtx(b.M));
  fsApi.write("/storage/note.txt", "hello from boot 2");
  assert.equal(fsApi.readText("/storage/note.txt"), "hello from boot 2");
  assert.ok(fsApi.list("/storage/kode").length > 0);
});
await b.flush();
await b.stop();

// boot 3: powered on again (not a reset): everything still there, plus the note
const c = await bench.boot(pkg, { reason: RESET.POWERON });
await check("power cycle: setting and files are still there, volume not re-seeded", async () => {
  await c.waitFor(() => c.logText().includes("kgui assets: source=fat"), 60000, "pack from the FAT");
  assert.ok(!c.logText().includes("factory content:"));
  const { default: storage } = await import("../../../runtime/drivers/storage/storage.js");
  const { glueCtx } = await import("../persist/host.mjs");
  assert.equal(storage(glueCtx(c.M)).readText("/storage/note.txt"), "hello from boot 2");
  await c.waitFor(() => c.logText().includes("zone: " + ZONE), 15000, "AO_Boot loads the stored zone");
});
await c.stop();

// ------------------------------------------------------------------------------------------------ erase device
await bench.pm.erase();
const d = await bench.boot(pkg, { reason: RESET.POWERON });
await check("after 'erase device': the volume is blank again, so formatted and seeded again; the setting and the note are gone", async () => {
  await d.waitFor(() => d.logText().includes("kgui assets: source=fat"), 60000, "pack from the FAT");
  assert.match(d.logText(), /factory content: \d+ files/);
  const { default: storage } = await import("../../../runtime/drivers/storage/storage.js");
  const { glueCtx } = await import("../persist/host.mjs");
  const fsApi = storage(glueCtx(d.M));
  assert.equal(fsApi.stat("/storage/note.txt").exists, false);
  await d.waitFor(() => d.logText().includes("kgui first frame"), 60000, "first frame");
  d.console(`config key="zone"`);
  await sleep(1500);
  assert.ok(!d.logText().includes(ZONE), "the zone survived an erase");
});
await d.stop({ save: false });

console.log(failed ? "kodeos: FAILED" : "kodeos: PASSED");
process.exit(failed ? 1 : 0);
