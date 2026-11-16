// The UNMODIFIED examples/imu under varying bench inputs (orientation, shake, magnet), asserting on
// its log lines:  "imu a=(x, y, z) mg  w=(x, y, z) mdps  pitch=P roll=R deg"
//                 "mag m=(x, y, z) mG  heading=H deg"   (the example's own math: atan2(my, mx)).
import assert from "node:assert/strict";
import { boot, pkgPath, BTN, sleep } from "../harness.mjs";
import { makeCheck, finish, loadGlue } from "./lib.mjs";

const a = await boot(pkgPath("imu"));
const g = await loadGlue(a, "motion");
const M = g.api;
const { check, st } = makeCheck();
const pump = setInterval(() => g.tick(), 20);
const log = () => a.logText();
const imuLines = () => [...log().matchAll(/imu\s+a=\((-?\d+), (-?\d+), (-?\d+)\) mg\s+w=\((-?\d+), (-?\d+), (-?\d+)\) mdps\s+pitch=(-?\d+) roll=(-?\d+) deg/g)]
  .map((m) => ({ a: [+m[1], +m[2], +m[3]], w: [+m[4], +m[5], +m[6]], pitch: +m[7], roll: +m[8] }));
const magLines = () => [...log().matchAll(/mag\s+m=\((-?\d+), (-?\d+), (-?\d+)\) mG\s+heading=(-?\d+) deg/g)]
  .map((m) => ({ m: [+m[1], +m[2], +m[3]], heading: +m[4] }));
const settle = async (n = 3) => { const k = imuLines().length; await a.waitFor(() => imuLines().length >= k + n, 15000, "fresh imu lines"); };
const near = (x, y, tol, what) => assert.ok(Math.abs(x - y) <= tol, `${what}: ${x} vs ${y} (+-${tol})`);

await a.waitFor(() => imuLines().length > 0 && magLines().length > 0, 15000, "first imu and mag lines");

await check("defaults: flat face-up, heading north: a=(0,0,1000) mg, w=0, pitch=roll=0, m=(0,250,-380) mG", async () => {
  const l = imuLines().at(-1), m = magLines().at(-1);
  assert.deepEqual(l.a, [0, 0, 1000]);
  assert.deepEqual(l.w, [0, 0, 0]);
  assert.equal(l.pitch, 0); assert.equal(l.roll, 0);
  assert.deepEqual(m.m, [0, 250, -380]);
  assert.equal(m.heading, 90, "atan2(250, 0)");
});
await check("pitch 20, roll -15 gives the accelerometer gravity and the example's pitch/roll", async () => {
  M.setOrientation({ pitch: 20, roll: -15 }, 0);
  await settle();
  const l = imuLines().at(-1);
  const p = (20 * Math.PI) / 180, r = (-15 * Math.PI) / 180;
  near(l.a[0], -Math.sin(p) * 1000, 3, "ax");
  near(l.a[1], Math.cos(p) * Math.sin(r) * 1000, 3, "ay");
  near(l.a[2], Math.cos(p) * Math.cos(r) * 1000, 3, "az");
  near(l.pitch, 20, 1, "pitch"); near(l.roll, -15, 1, "roll");
  assert.deepEqual(l.w, [0, 0, 0], "gyro still");
  const mag = Math.hypot(...l.a);
  near(mag, 1000, 4, "|a| = 1 g");
});
await check("moving: the gyro reports rates while the orientation changes and 0 once still", async () => {
  M.setOrientation({ pitch: 0, roll: 0 }, 0);
  await settle();
  const k = imuLines().length;
  M.setOrientation({ roll: 80 }, 1600);
  await a.waitFor(() => imuLines().length >= k + 6, 15000, "lines during the move");
  const during = imuLines().slice(k);
  const peak = Math.max(...during.map((l) => Math.abs(l.w[0])));
  assert.ok(peak > 30000, "gx peak " + peak + " mdps (80 deg in 1.6 s is >= 50000 mdps mean)");
  await a.waitFor(() => !M.moving(), 5000, "move over");
  await settle(3);
  assert.deepEqual(imuLines().at(-1).w, [0, 0, 0]);
  near(imuLines().at(-1).roll, 80, 1, "roll after the move");
});
await check("heading east turns the magnetometer: field north now along -x; the log tracks it", async () => {
  M.setOrientation({ pitch: 0, roll: 0, heading: 90 }, 0);
  await settle();
  const m = magLines().at(-1);
  near(m.m[0], -250, 2, "mx"); near(m.m[1], 0, 2, "my"); near(m.m[2], -380, 2, "mz");
  near(Math.abs(m.heading), 180, 1, "example's atan2(my, mx)");
});
await check("a magnet near the sensor adds its field and the log shows it", async () => {
  M.setOrientation({ heading: 0 }, 0);
  M.setMagnet({ x: 1200, y: 0, z: -500 });
  await settle();
  const m = magLines().at(-1);
  near(m.m[0], 1200, 3, "mx"); near(m.m[1], 250, 3, "my"); near(m.m[2], -880, 3, "mz");
  M.setMagnet(null);
  await settle();
  assert.deepEqual(magLines().at(-1).m, [0, 250, -380]);
});
await check("a shake burst shows up as acceleration well above 1 g in the log", async () => {
  const k = imuLines().length;
  M.shake({ peak: 3, ms: 900, hz: 7 });
  await a.waitFor(() => imuLines().length >= k + 6, 15000, "lines during the shake");
  const peak = Math.max(...imuLines().slice(k).map((l) => Math.hypot(...l.a)));
  assert.ok(peak > 1600, "peak |a| " + peak + " mg");
  await a.waitFor(() => !M.shaking(), 3000, "shake over");
  await settle(3);
  near(Math.hypot(...imuLines().at(-1).a), 1000, 4, "back to 1 g");
});
await check("the driver's programmed ranges and rates are what the model honours", () => {
  const c = M.config();
  assert.equal(c.accelRangeG, 8); assert.equal(c.gyroRangeDps, 512);
  assert.ok(c.accelOn && c.gyroOn && c.magOn);
  near(c.accelOdrHz, 896.8, 0.5, "6DOF accel ODR");
  assert.equal(c.magOdrHz, 50);
});
await check("top button pauses the example (no new lines), top again resumes", async () => {
  a.button(BTN.TOP, true); await sleep(80); a.button(BTN.TOP, false);
  await sleep(500);
  const k = imuLines().length;
  await sleep(900);
  assert.equal(imuLines().length, k, "paused");
  a.button(BTN.TOP, true); await sleep(80); a.button(BTN.TOP, false);
  await settle(2);
});
clearInterval(pump);
a.shutdown();
finish("motion example", st);
