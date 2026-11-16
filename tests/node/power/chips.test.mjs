// Register-level tests of the BQ25896 (0x6B) and CW2217 (0x64) models, hosted by buttons_led
// (no power driver running, so nothing else touches the chips).
import assert from "node:assert/strict";
import { boot, pkgPath, sleep } from "../harness.mjs";
import { makeCheck, finish, bus, loadGlue } from "./lib.mjs";

const a = await boot(pkgPath("buttons_led"));
await a.waitFor(() => a.logText().includes("up;") && a.logText().includes("AW86233 parked"), 15000, "boot and the SDK's park pass");
const { check, st } = makeCheck();
const { rd, wr, r8 } = bus(a, "power");
const BQ = 0x6b, CW = 0x64;
const g = await loadGlue(a, "power");
const P = g.api;
const reset = () => { P.setLevel(80); P.plug(false); P.setTemperature(25); P.setLoad(90); P.setVoltage(null); wr(BQ, 0x14, [0x80]); wr(BQ, 0x09, [0x44]); };

await check("unregistered address NACKs", () => assert.notEqual(a.M._power_i2c_read(0x55, 0, a.M._malloc(4), 1), 0));
await check("BQ25896 identity: REG14 reset value 0x02 (PN 000, DEV_REV 10)", () => {
  reset();
  assert.equal(r8(BQ, 0x14), 0x02);
  wr(BQ, 0x14, [0x3f]);
  assert.equal(r8(BQ, 0x14), 0x02, "PN and revision are read only");
});
await check("BQ25896 read-only registers ignore writes", () => {
  const before = r8(BQ, 0x0b);
  wr(BQ, 0x0b, [0xff]);
  assert.equal(r8(BQ, 0x0b), before);
});
await check("BQ25896 config registers store (ICHG, VREG, IINLIM)", () => {
  wr(BQ, 0x04, [0x08]); wr(BQ, 0x06, [0x5e]);
  assert.equal(r8(BQ, 0x04), 0x08);
  assert.equal(r8(BQ, 0x06), 0x5e);
});
await check("cable status: none / SDP / adapter in REG0B", () => {
  reset();
  assert.equal(r8(BQ, 0x0b) & 0x04, 0, "PG_STAT low unplugged");
  P.plug(true, "usb");
  let v = r8(BQ, 0x0b);
  assert.equal(v & 0x04, 0x04, "power good");
  assert.equal(v >> 5, 1, "VBUS_STAT = SDP");
  P.plug(true, "adapter");
  assert.equal(r8(BQ, 0x0b) >> 5, 2, "VBUS_STAT = adapter");
  P.plug(false);
  assert.equal(r8(BQ, 0x0b) >> 5, 0);
});
await check("charging phase appears in CHRG_STAT (bits 4:3) and the battery current is positive", () => {
  reset(); P.setLevel(50); P.plug(true, "adapter");
  assert.equal((r8(BQ, 0x0b) >> 3) & 3, 2, "fast charge");
  assert.ok(P.currentMa() > 0);
  P.setLevel(100);
  assert.equal((r8(BQ, 0x0b) >> 3) & 3, 3, "charge done at 100 %");
  P.plug(false);
});
await check("ADC one-shot: zero before CONV_START, valid 1 s after, bit self-clears", async () => {
  reset(); P.setLevel(80);
  assert.equal(r8(BQ, 0x0e), 0, "bottom of scale before any conversion");
  wr(BQ, 0x02, [0x80 | (r8(BQ, 0x02) & 0x7f)]);
  assert.equal(r8(BQ, 0x02) & 0x80, 0, "CONV_START self-clears");
  assert.equal(r8(BQ, 0x0e), 0, "not ready at once");
  await sleep(1100);
  const mv = 2304 + (r8(BQ, 0x0e) & 0x7f) * 20;
  assert.ok(Math.abs(mv - P.voltage()) <= 20, `BATV ${mv} mV vs model ${P.voltage()} mV`);
});
await check("NTC: hot battery sets REG0C and blocks charging", () => {
  reset(); P.setLevel(50); P.plug(true, "adapter"); P.setTemperature(65);
  assert.equal(r8(BQ, 0x0c) & 7, 6, "hot");
  assert.equal(P.charging(), "none");
  P.setTemperature(25); P.plug(false);
});
await check("ship mode: BATFET_DIS write raises a ship event; unplugged and not delayed = shipped", () => {
  reset();
  g.emitted.length = 0;
  wr(BQ, 0x09, [r8(BQ, 0x09) | 0x20]);
  g.tick();
  const ev = g.emitted.find((e) => e.type === "ship");
  assert.ok(ev, "ship event");
  assert.equal(ev.data.usb, false);
  assert.equal(P.shipped(), true);
  wr(BQ, 0x14, [0x80]);    // register reset leaves ship mode
  assert.equal(P.shipped(), false);
});
await check("CW2217 identity and awake at power-on (CONFIG 0x00)", () => {
  reset();
  assert.equal(r8(CW, 0x00), 0xa0);
  assert.equal(r8(CW, 0x08), 0x00);
  assert.equal(r8(CW, 0xa7) & 0x0c, 0x0c, "READY");
});
await check("CW2217 readings follow the battery: VCELL, SOC, TEMP, CURRENT", () => {
  reset(); P.setLevel(60); P.setTemperature(31);
  const [h, l] = rd(CW, 0x02, 2);
  const mv = (((h << 8) | l) & 0x3fff) * 5 / 16;
  assert.ok(Math.abs(mv - P.voltage()) <= 2, `VCELL ${mv} vs ${P.voltage()}`);
  assert.equal(r8(CW, 0x04), 60);
  assert.equal(r8(CW, 0x06) / 2 - 40, 31);
  const [ch, cl] = rd(CW, 0x0e, 2);
  const cur = (((ch << 8) | cl) << 16 >> 16) * 160 / 1000;
  assert.ok(cur < 0 && Math.abs(cur + 90) < 1, `discharging at 90 mA, got ${cur}`);
  P.plug(true, "adapter");
  const [ph, pl] = rd(CW, 0x0e, 2);
  assert.ok((((ph << 8) | pl) << 16 >> 16) > 0, "charging current positive");
  P.plug(false);
});
await check("CW2217 restart sequence 0xF0 -> 0x30 -> 0x00: not ready, then ready after ~1.5 s", async () => {
  wr(CW, 0x08, [0xf0]); assert.equal(r8(CW, 0xa7) & 0x0c, 0);
  wr(CW, 0x08, [0x30]); wr(CW, 0x08, [0x00]);
  assert.equal(r8(CW, 0xa7) & 0x0c, 0, "not ready at once");
  await sleep(1700);
  assert.equal(r8(CW, 0xa7) & 0x0c, 0x0c);
});
await check("glue: level/voltage/cable/temperature API and defaults", () => {
  reset();
  assert.equal(P.level(), 80);
  assert.equal(P.cable(), "none");
  assert.ok(P.voltage() > 3900 && P.voltage() < 4050);
  P.setLevel(0); assert.ok(P.voltage() <= 3350);
  P.setLevel(100); assert.ok(P.voltage() >= 4150);
  P.setLevel(80);
});
a.shutdown();
finish("power chips", st);
