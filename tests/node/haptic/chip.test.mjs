// Register-level tests of the AW86233 model (0x5A), hosted by buttons_led (no haptic driver).
import assert from "node:assert/strict";
import { boot, pkgPath, sleep } from "../harness.mjs";
import { makeCheck, finish, bus, loadGlue } from "./lib.mjs";

const a = await boot(pkgPath("buttons_led"));
await a.waitFor(() => a.logText().includes("up;") && a.logText().includes("AW86233 parked"), 15000, "boot and the SDK's park pass");
const { check, st } = makeCheck();
const { rd, wr, r8 } = bus(a, "haptic");
const g = await loadGlue(a, "haptic");
const H = g.api, A = 0x5a;
const reset = () => wr(A, 0x00, [0xaa]);
const feed = (n, v) => wr(A, 0x32, new Array(n).fill(v));

await check("identity: CHIPID 0x57 = 0x23 and 0x69 = 0x30", () => {
  assert.equal(r8(A, 0x57), 0x23);
  assert.equal(r8(A, 0x69), 0x30);
});
await check("soft reset 0xAA: SYSCTRL2 = 0x40 (standby), gain restored", () => {
  wr(A, 0x07, [0x55]);
  reset();
  assert.equal(r8(A, 0x46), 0x40);
});
await check("config registers store: gain, mode", () => {
  wr(A, 0x46, [0x00]); wr(A, 0x07, [0x99]); wr(A, 0x08, [0x01]);
  assert.equal(r8(A, 0x07), 0x99);
  assert.equal(r8(A, 0x08), 0x01);
  assert.equal(r8(A, 0x3f), 0x00, "GLBRD5 idle = 0");
});
await check("GO ignored in standby; plays out of standby", () => {
  reset(); wr(A, 0x07, [204]); wr(A, 0x08, [1]);
  feed(100, 100);
  wr(A, 0x09, [0x01]);
  assert.equal(H.playing(), false, "standby swallowed GO");
  wr(A, 0x46, [0x00]);
  feed(100, 100);
  wr(A, 0x09, [0x01]);
  assert.equal(H.playing(), true);
  assert.equal(r8(A, 0x3f), 0x08, "GLBRD5 = 8 while playing RTP");
  wr(A, 0x09, [0x02]);
  assert.equal(H.playing(), false, "STOP");
});
await check("level = (peak/127) * (gain/255) / 0.64 on the bridge, 0 when stopped", async () => {
  reset(); wr(A, 0x46, [0x02]); wr(A, 0x07, [204]); wr(A, 0x08, [1]);
  const seq = a.u32(0x5c);
  wr(A, 0x09, [0x01]);
  feed(2000, 127);
  H.poll();
  assert.ok(H.level() > 0.9 && H.level() <= 1, "full drive " + H.level());
  assert.ok(a.u32(0x5c) > seq);
  wr(A, 0x09, [0x02]);
  H.poll();
  assert.equal(H.level(), 0);
});
await check("half the sample peak gives half the drive (before the full-drive normalisation)", async () => {
  reset(); wr(A, 0x46, [0x02]); wr(A, 0x07, [204]); wr(A, 0x08, [1]);
  wr(A, 0x09, [0x01]);
  feed(2000, 64);
  H.poll();
  const l = H.level();
  wr(A, 0x09, [0x02]);
  assert.ok(Math.abs(l - (64 / 127) * 0.8 / 0.64) < 0.02, "level " + l);   // 0.63: gain 80 % x peak 50 %, over the 0.64 full drive
});
await check("FIFO: bytes before GO are not played; FF_AFS (SYSST bit 3) is set at 1536 queued and clears as it drains", async () => {
  reset(); wr(A, 0x46, [0x00]); wr(A, 0x08, [1]); wr(A, 0x07, [204]);
  feed(300, 50);
  assert.equal(H.playing(), false, "data without GO is not played");
  wr(A, 0x09, [0x01]);
  feed(2000, 50);
  assert.equal(r8(A, 0x01) & 0x08, 0x08, "full: almost-full flag");
  await sleep(150);                // 12 kHz: ~1800 samples out
  assert.equal(r8(A, 0x01) & 0x08, 0, "drained below 1536");
  wr(A, 0x09, [0x02]);
});
await check("the chip leaves RTP itself when the FIFO runs dry; stop event reports samples", async () => {
  reset(); wr(A, 0x46, [0x02]); wr(A, 0x08, [1]); wr(A, 0x07, [204]);
  H.poll(); g.emitted.length = 0;      // drop events of the previous test
  wr(A, 0x09, [0x01]);
  feed(600, 100);                  // 50 ms at 12 kHz
  await sleep(150);
  H.poll();
  assert.equal(H.playing(), false);
  assert.equal(r8(A, 0x3f), 0x00, "back out of RTP");
  const stop = g.emitted.find((e) => e.type === "stop");
  assert.ok(stop, "stop event");
  assert.equal(stop.data.samples, 600);
  assert.equal(stop.data.durationMs, 50);
});
await check("SYSCTRL2 rate bits: 24 kHz and 48 kHz are honoured", async () => {
  for (const [bits, hz] of [[0, 24000], [1, 48000], [2, 12000]]) {
    reset(); wr(A, 0x46, [bits]); wr(A, 0x08, [1]);
    assert.equal(H.rateHz(), hz);
  }
});
await check("unknown address NACKs", () => assert.notEqual(a.M._haptic_i2c_read(0x5b, 0, a.M._malloc(2), 1), 0));
a.shutdown();
finish("haptic chip", st);
