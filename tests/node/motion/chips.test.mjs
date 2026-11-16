// Register-level tests of the QMI8658A (0x6A) and QMC5883P (0x2C) models, hosted by buttons_led
// (no motion driver running, so nothing else programs the chips).
import assert from "node:assert/strict";
import { boot, pkgPath, sleep } from "../harness.mjs";
import { makeCheck, finish, bus, loadGlue } from "./lib.mjs";

const a = await boot(pkgPath("buttons_led"));
await a.waitFor(() => a.logText().includes("up;") && a.logText().includes("AW86233 parked"), 15000, "boot and the SDK's park pass");
const { check, st } = makeCheck();
const { rd, wr, r8 } = bus(a, "motion");
const g = await loadGlue(a, "motion");
const M = g.api, Q = 0x6a, C = 0x2c;
const s16 = (lo, hi) => ((hi << 8) | lo) << 16 >> 16;
const near = (x, y, tol, what) => assert.ok(Math.abs(x - y) <= tol, `${what}: ${x} vs ${y} (+-${tol})`);
// the driver's setup: little endian + auto-increment, +-8 g, +-512 dps, ODR 3, both sensors on
const qmiOn = async (c2 = 0x23, c3 = 0x53, c7 = 0x03) => {
  wr(Q, 0x08, [0x00]); wr(Q, 0x02, [0x58]); wr(Q, 0x03, [c2]); wr(Q, 0x04, [c3]); wr(Q, 0x08, [c7]);
  await sleep(250);                     // gyro valid 150 ms + 3/ODR after enable
};
const burst = () => { const b = rd(Q, 0x33, 14); return { t: s16(b[0], b[1]), a: [s16(b[2], b[3]), s16(b[4], b[5]), s16(b[6], b[7])], w: [s16(b[8], b[9]), s16(b[10], b[11]), s16(b[12], b[13])] }; };
const flat = () => { M.setOrientation({ pitch: 0, roll: 0, heading: 0 }, 0); M.setMagnet(null); M.setField(250, 380); };

await check("QMI8658A identity: WHO_AM_I 0x05, revision 0x7C; unknown address NACKs", () => {
  assert.equal(r8(Q, 0x00), 0x05);
  assert.equal(r8(Q, 0x01), 0x7c);
  assert.notEqual(a.M._motion_i2c_read(0x6b, 0, a.M._malloc(2), 1), 0);
});
await check("QMI8658A CTRL1 reset is 0x20 (big endian, no auto-increment) and the config registers store", () => {
  wr(Q, 0x60, [0xb0]);        // soft reset (the SDK's park pass has already programmed the part)
  assert.equal(r8(Q, 0x02), 0x20);
  wr(Q, 0x02, [0x58]); wr(Q, 0x03, [0x23]); wr(Q, 0x04, [0x53]);
  assert.deepEqual(rd(Q, 0x02, 3), [0x58, 0x23, 0x53], "auto-increment burst");
});
await check("accelerometer flat, face up, +-8 g: z = +4096 LSB (+1 g), x = y = 0; gyro 0; temperature ~30 C", async () => {
  flat(); await qmiOn();
  const d = burst();
  assert.deepEqual(d.a, [0, 0, 4096]);
  assert.deepEqual(d.w, [0, 0, 0]);
  near(d.t / 256, 30, 1, "die temperature");
});
await check("accelerometer follows pitch/roll: pitch 30 gives ax = -sin(30) g, az = cos(30) g", async () => {
  M.setOrientation({ pitch: 30, roll: 0 }, 0);
  await sleep(20);
  const d = burst();
  near(d.a[0], -2048, 3, "ax"); near(d.a[1], 0, 3, "ay"); near(d.a[2], Math.round(Math.cos(Math.PI / 6) * 4096), 3, "az");
  M.setOrientation({ pitch: 0, roll: 90 }, 0);
  await sleep(20);
  const e = burst();
  near(e.a[1], 4096, 3, "ay = +1 g when the top points up (roll 90)"); near(e.a[2], 0, 3, "az");
});
await check("the full-scale range the driver programs sets the LSB size (+-2/4/8/16 g)", async () => {
  flat();
  for (const [fs, lsb] of [[0, 16384], [1, 8192], [2, 4096], [3, 2048]]) {
    wr(Q, 0x03, [0x03 | (fs << 4)]);
    await sleep(10);
    assert.equal(burst().a[2], lsb, "az at FS " + fs);
  }
  wr(Q, 0x03, [0x23]);
});
await check("a large shake saturates the +-2 g range instead of wrapping", async () => {
  wr(Q, 0x03, [0x03]);      // +-2 g
  M.shake({ peak: 6, ms: 600, hz: 6, dir: [0, 0, 1] });
  let max = 0;
  for (let i = 0; i < 40; i++) { max = Math.max(max, burst().a[2]); await sleep(10); }
  assert.equal(max, 32767, "clipped at full scale");
  await sleep(300);
  wr(Q, 0x03, [0x23]);
});
await check("gyroscope: rates while the orientation changes (integral = the angle), zero when still, +-512 dps scale", async () => {
  flat(); await sleep(30);
  M.setOrientation({ roll: 60 }, 800);
  let sum = 0, t = Date.now(), peak = 0;
  while (M.moving()) {
    const d = burst(), now = Date.now();
    // CTRL3 = 0x53: FS code 5 -> 2048>>5 = 64 LSB/dps
    sum += d.w[0] / 64 * ((now - t) / 1000); t = now; peak = Math.max(peak, Math.abs(d.w[0] / 64));
    await sleep(8);
  }
  near(sum, 60, 12, "integrated roll angle in degrees");
  assert.ok(peak > 60 && peak < 500, "peak rate " + peak + " dps, inside the +-512 range");
  await sleep(30);
  assert.deepEqual(burst().w, [0, 0, 0]);
});
await check("data is zero before the enable settles: gyro needs 150 ms + 3/ODR", async () => {
  wr(Q, 0x08, [0x00]); flat();
  M.setOrientation({ roll: 0 }, 0);
  wr(Q, 0x08, [0x03]);
  assert.deepEqual(burst().a, [0, 0, 0], "accel not converted yet");
  await sleep(60);
  assert.ok(burst().a[2] > 4000, "accel ready after a few ODR periods");
  assert.equal(r8(Q, 0x2e) & 0x02, 0, "gyro not ready at 60 ms");
  await sleep(200);
  assert.equal(r8(Q, 0x2e) & 0x03, 0x03, "both ready");
});
await check("ODR the driver programs: accel-only 1000 Hz at code 3, both sensors 896.8 Hz", async () => {
  await qmiOn(0x23, 0x53, 0x01);
  let c = M.config(); near(c.accelOdrHz, 1000, 0.1, "accel only"); assert.equal(c.gyroOn, false);
  await qmiOn(0x23, 0x53, 0x03);
  c = M.config(); near(c.accelOdrHz, 896.8, 0.1, "6DOF");
  wr(Q, 0x04, [0x56]); near(M.config().accelOdrHz, 112.1, 0.1, "6DOF code 6");
  wr(Q, 0x04, [0x53]);
});
await check("FIFO: FIFO mode fills at the accel ODR up to 128 samples; the count is in words; the data is the gravity", async () => {
  flat(); await qmiOn();
  wr(Q, 0x14, [0x00]); wr(Q, 0x0a, [0x04]);     // reset FIFO
  wr(Q, 0x14, [0x0d]);                           // FIFO mode, 128 samples
  await sleep(250);
  const cnt = r8(Q, 0x15) | ((r8(Q, 0x16) & 3) << 8);
  assert.equal(cnt, 128 * 3, "128 samples = 384 words (full)");
  const b = rd(Q, 0x17, 12);
  assert.deepEqual([s16(b[0], b[1]), s16(b[2], b[3]), s16(b[4], b[5])], [0, 0, 4096]);
  const left = r8(Q, 0x15) | ((r8(Q, 0x16) & 3) << 8);
  assert.ok(left >= 126 * 3 - 3 && left <= 128 * 3, "two samples drained, the stream refills: " + left);
  await sleep(100);
  assert.equal(r8(Q, 0x15) | ((r8(Q, 0x16) & 3) << 8), 128 * 3, "refilled to full after draining");
  wr(Q, 0x14, [0x00]);
});
await check("CTRL9 handshake: with CTRL8 bit 7 the command-done flag appears in STATUSINT bit 7 and clears on CTRL9=0", () => {
  wr(Q, 0x09, [0x80]);
  wr(Q, 0x0a, [0x05]);
  assert.equal(r8(Q, 0x2d) & 0x80, 0x80);
  wr(Q, 0x0a, [0x00]);
  assert.equal(r8(Q, 0x2d) & 0x80, 0);
});
await check("self-test: accel stimulus reads 1100 dV LSB after the test time, gyro 8000; flag clears", async () => {
  wr(Q, 0x03, [0x23 | 0x80]);
  await sleep(30);
  assert.equal(r8(Q, 0x2d) & 1, 1, "self-test done");
  const b = rd(Q, 0x51, 6);
  assert.deepEqual([s16(b[0], b[1]), s16(b[2], b[3]), s16(b[4], b[5])], [1100, 1100, 1100]);
  wr(Q, 0x03, [0x23]);
  assert.equal(r8(Q, 0x2d) & 1, 0);
  wr(Q, 0x04, [0x53 | 0x80]); await sleep(30);
  assert.equal(s16(...rd(Q, 0x51, 2)), 8000);
  wr(Q, 0x04, [0x53]);
});

// ---- QMC5883P
await check("QMC5883P identity: chip id 0x80 at 0; the stray address 0x0C NACKs", () => {
  assert.equal(r8(C, 0x00), 0x80);
  assert.notEqual(a.M._motion_i2c_read(0x0c, 0, a.M._malloc(2), 1), 0);
});
await check("QMC5883P suspended by default: no DRDY; CTRL1 = 0x07 starts 50 Hz continuous", async () => {
  flat();
  assert.equal(r8(C, 0x09) & 1, 0);
  wr(C, 0x0b, [0x00]); wr(C, 0x0a, [0x07]);
  await sleep(40);
  assert.equal(r8(C, 0x09) & 1, 1, "DRDY after one period");
  const d = rd(C, 0x01, 6);
  assert.deepEqual([s16(d[0], d[1]), s16(d[2], d[3]), s16(d[4], d[5])], [0, 250, -380], "+-30 G: 1 LSB per mG; flat heading north");
  assert.equal(r8(C, 0x09) & 1, 0, "DRDY drops once read");
});
await check("magnetometer follows the heading (east: field north along -x) and tilt", async () => {
  M.setOrientation({ pitch: 0, roll: 0, heading: 90 }, 0);
  await sleep(40);
  let d = rd(C, 0x01, 6);
  near(s16(d[0], d[1]), -250, 2, "mx"); near(s16(d[2], d[3]), 0, 2, "my"); near(s16(d[4], d[5]), -380, 2, "mz");
  M.setOrientation({ pitch: 0, roll: 90, heading: 0 }, 0);       // top up: the downward field runs along -y
  await sleep(40);
  d = rd(C, 0x01, 6);
  near(s16(d[2], d[3]), -380, 3, "my = -D with the top up");
  flat();
});
await check("magnet near: adds to the field; beyond the programmed range sets OVFL; a wider range clears it", async () => {
  wr(C, 0x0b, [0x0c]);          // +-2 G
  M.setMagnet({ x: 5000, y: 0, z: 0 });
  await sleep(40);
  assert.equal(r8(C, 0x09) & 0x03, 0x03, "DRDY and OVFL");
  wr(C, 0x0b, [0x00]);          // +-30 G
  await sleep(40);
  assert.equal(r8(C, 0x09) & 0x03, 0x01, "DRDY only");
  const d = rd(C, 0x01, 2);
  near(s16(d[0], d[1]), 5000, 2, "mx");
  M.setMagnet(null);
});
await check("range changes the LSB per gauss (2500/3750/15000 LSB per G)", async () => {
  flat();
  for (const [bits, lsbG] of [[1, 2500], [2, 3750], [3, 15000]]) {
    wr(C, 0x0b, [bits << 2]); await sleep(30);
    const d = rd(C, 0x01, 6);
    near(s16(d[2], d[3]), Math.round(0.25 * lsbG), 2, "my at range " + bits);
  }
  wr(C, 0x0b, [0x00]);
});
await check("self-test: the +-1.5 G stimulus appears for one read, then the part parks in suspend", async () => {
  wr(C, 0x0b, [0x40]); await sleep(40);
  const d = rd(C, 0x01, 6);
  near(s16(d[0], d[1]), -1500, 3, "x"); near(s16(d[2], d[3]), 250 + 1500, 3, "y");
  assert.equal(r8(C, 0x0a) & 3, 0, "suspended after the self-test");
});
await check("suspend (CTRL1 = 0) stops the conversions; soft reset clears the config", async () => {
  wr(C, 0x0b, [0x00]); wr(C, 0x0a, [0x07]); await sleep(40);
  wr(C, 0x0a, [0x00]); r8(C, 0x01); rd(C, 0x01, 6); await sleep(40);
  assert.equal(r8(C, 0x09) & 1, 0, "no DRDY while suspended");
  wr(C, 0x0a, [0x07]); wr(C, 0x0b, [0x80]);
  assert.equal(r8(C, 0x0a), 0x00);
  assert.equal(r8(C, 0x00), 0x80);
});
a.shutdown();
finish("motion chips", st);
