// kodeOS boots under Node and reaches its lock screen (the face, with Kody drawn by ThorVG/Lottie from the pack on the
// in-memory FAT stand-in), then a swipe takes it to the launcher, which shows its empty state (no apps installed yet).
//   tests/node/kodeos/run.sh        (builds the OS package first; named *.kodeos-test.mjs so tests/node/run.sh does not
//                                    pick it up: see docs/STATUS-kodeos.md)
import assert from "node:assert/strict";
import { boot, OFF, sleep } from "../harness.mjs";
import { savePng } from "./png.mjs";
import path from "node:path";
import fs from "node:fs";

const build = process.env.DOTBENCH_BUILD || path.join(path.dirname(new URL(import.meta.url).pathname), "../../../build");
const pkg = path.join(build, "apps/kodeos/kodeos.dotbench");
const shotDir = process.env.KODEOS_SHOTS;      // optional: save PNGs of the milestones there
const a = await boot(pkg);
let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); }
  catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};
const W = () => a.u32(OFF.fbW), H = () => a.u32(OFF.fbH);
const distinctColours = (fb) => { const s = new Set(); for (let i = 0; i < fb.length; i += 4) s.add((fb[i] | (fb[i + 1] << 8) | (fb[i + 2] << 16)) >>> 0); return s.size; };
const litPixels = (fb) => { let n = 0; for (let i = 0; i < fb.length; i += 4) if (fb[i] | fb[i + 1] | fb[i + 2]) n++; return n / (fb.length / 4); };
/** rows [y0,y1) of the framebuffer as a Buffer */
const band = (fb, y0, y1) => Buffer.from(fb.subarray(y0 * a.u32(OFF.fbStride), y1 * a.u32(OFF.fbStride)));
const shot = (name) => { if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); savePng(path.join(shotDir, name), a.framebuffer(), W(), H(), a.u32(OFF.fbStride)); } };
const swipeLeft = async () => {
  for (let x = 360; x >= 40; x -= 40) { a.touch(x, 300, true); await sleep(40); }
  a.touch(40, 300, false);
};

await check("boots, the real AOs come up and the first frame is drawn", async () => {
  await a.waitFor(() => a.logText().includes("kgui first frame"), 60000, "kgui first frame");
  const t = a.logText();
  for (const s of ["kaos.storage up", "kaos.ioexp up", "kaos.buttons up", "kaos.display up at 100%", "kaos.ledmgr up", "kcli console up"])
    assert.ok(t.includes(s), "missing log line: " + s);
  assert.equal(a.u32(OFF.panelOn), 1);
  assert.equal(W(), 410);
  assert.equal(H(), 502);
});

await check("Kody's pack is read from the FAT stand-in and inflated (no 'do not inflate' warning)", async () => {
  await a.waitFor(() => a.logText().includes("kgui assets: source=fat"), 20000, "pack read from the FAT");
  await a.waitFor(() => a.logText().includes("kgui face: drew "), 20000, "face scene drawn");
  assert.ok(!a.logText().includes("do not inflate"), a.logText());
});

await check("lock screen: a non-trivial framebuffer (clock, pill, Kody)", async () => {
  await sleep(1500);
  const fb = a.framebuffer();
  assert.ok(distinctColours(fb) > 8, "distinct colours: " + distinctColours(fb));
  assert.ok(litPixels(fb) > 0.2, "lit fraction: " + litPixels(fb));
  shot("lock-screen.png");
});

await check("lock screen is stable: the clock band never changes, the glass is never declared lost, frames keep coming", async () => {
  const seq0 = a.frameSeq();
  const clock0 = band(a.framebuffer(), 30, 190);
  await sleep(700);
  const clock1 = band(a.framebuffer(), 30, 190);
  await sleep(700);
  const clock2 = band(a.framebuffer(), 30, 190);
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
  await swipeLeft();
  await a.waitFor(() => a.logText().includes("kgui empty launcher"), 15000, "'kgui empty launcher'");
  await sleep(1500);
  const fb = a.framebuffer();
  assert.ok(!Buffer.from(before).equals(Buffer.from(fb)), "framebuffer unchanged");
  assert.ok(distinctColours(fb) > 6, "distinct colours: " + distinctColours(fb));
  assert.ok(!a.restartRequested());
  shot("launcher-empty.png");
});

a.shutdown();
console.log(failed ? "kodeos: FAILED" : "kodeos: PASSED");
process.exit(failed ? 1 : 0);
