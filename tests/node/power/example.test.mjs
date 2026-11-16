// The UNMODIFIED examples/power under varying bench inputs, asserting on its log output.
// The bench is the JS glue (levels, cable, temperature) acting on the C battery model.
import assert from "node:assert/strict";
import { boot, pkgPath, BTN, sleep } from "../harness.mjs";
import { makeCheck, finish, loadGlue } from "./lib.mjs";

const a = await boot(pkgPath("power"));
const g = await loadGlue(a, "power");
const P = g.api;
const { check, st } = makeCheck();
const log = () => a.logText();
const waitLog = (re, ms, what) => a.waitFor(() => re.test(log()), ms, what);
const pump = setInterval(() => g.tick(), 20);   // the page's 20 ms tick

await check("defaults: first reading 80 %, ~3997 mV, USB absent, not charging", async () => {
  await waitLog(/power first reading: 80%, \d+ mV, USB absent, not charging/, 8000, "first reading");
  const mv = +log().match(/first reading: 80%, (\d+) mV/)[1];
  assert.ok(Math.abs(mv - P.voltage()) < 30, `log ${mv} mV vs model ${P.voltage()} mV`);
  assert.ok(mv > 3900 && mv < 4050, "80 % sits near 3.95-4.0 V on the curve");
});
await check("plugging USB logs 'USB plugged in' and the charger starts", async () => {
  P.plug(true, "adapter");
  await waitLog(/USB plugged in/, 6000, "plug message");
  assert.ok(P.isCharging());
  assert.ok(P.currentMa() > 0);
});
await check("top button prints the battery with charging state", async () => {
  a.button(BTN.TOP, true); await sleep(80); a.button(BTN.TOP, false);
  await waitLog(/battery: \d+%, \d+ mV.*(charging)/, 5000, "battery line while charging");
});
await check("unplugging logs 'USB unplugged' and charging stops", async () => {
  P.plug(false);
  await waitLog(/USB unplugged/, 6000, "unplug message");
  assert.equal(P.charging(), "none");
});
await check("changing the level moves the reading the SDK computes (80 -> 70 %; the AO slews 2 % per poll)", async () => {
  P.setLevel(70);
  const t0 = Date.now();
  let seen = null;
  while (Date.now() - t0 < 45000 && seen === null) {
    a.button(BTN.TOP, true); await sleep(60); a.button(BTN.TOP, false);
    await sleep(1500);
    const m = [...log().matchAll(/battery: (\d+)%/g)].map((x) => +x[1]);
    if (m.length && Math.abs(m[m.length - 1] - 70) <= 2) seen = m[m.length - 1];
  }
  assert.notEqual(seen, null, "the reported level reached 70 +- 2");
});
await check("bottom button arms; a second press asks for power-off and the app sees power:off", async () => {
  g.emitted.length = 0;
  a.button(BTN.BOT, true); await sleep(80); a.button(BTN.BOT, false);
  await sleep(300);
  a.button(BTN.BOT, true); await sleep(80); a.button(BTN.BOT, false);
  await a.waitFor(() => { g.tick(); return g.emitted.some((e) => e.type === "off"); }, 6000, "power:off event");
  const ev = g.emitted.find((e) => e.type === "off");
  assert.ok(ev.data.target, "event names the target");
  assert.match(log(), /AO_LowPower did not take the request/);
});
await check("empty cell on battery makes AO_Power cut the cell: ship event reaches the app", async () => {
  g.emitted.length = 0;
  P.plug(false);
  P.setLevel(0);
  await a.waitFor(() => { g.tick(); return g.emitted.some((e) => e.type === "ship"); }, 60000, "ship event");
  assert.equal(P.shipped(), true);
});
clearInterval(pump);
a.shutdown();
finish("power example", st);
