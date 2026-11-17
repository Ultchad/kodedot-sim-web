// The USB-C cable under the UNMODIFIED examples/power app: VBUS through the power area, the console pipe, the rules around them.
import assert from "node:assert/strict";
import { boot, pkgPath, BTN, sleep } from "../harness.mjs";
import { makeCheck, finish, loadGlues } from "./lib.mjs";

const a = await boot(pkgPath("power"));
const G = await loadGlues(a, ["usb", "power"]);
const U = G.usb.api, P = G.power.api;
const { check, st } = makeCheck();
const log = () => a.logText();
const waitLog = (re, ms, what) => a.waitFor(() => re.test(log()), ms, what);
let acc = "";
const cableText = () => {   // the glue's tick drains the cable and emits "data": that is what the computer sees
  for (const e of G.usb.emitted.splice(0)) if (e.type === "data") acc += new TextDecoder().decode(e.data);
  return acc;
};
const takeCable = () => { const s = cableText(); acc = ""; return s; };
const press = async (b) => { a.button(b, true); await sleep(80); a.button(b, false); };

await check("starts unplugged: no VBUS, nothing on the cable", async () => {
  await waitLog(/power first reading: \d+%, \d+ mV, USB absent, not charging/, 15000, "first reading");
  assert.equal(U.plugged(), false); assert.equal(P.cable(), "none");
  await press(BTN.TOP); await sleep(500);
  assert.equal(takeCable(), "", "no computer, nothing is queued");
});
await check("plug with a computer: the Dot notices through the charger chip (log), charging starts as a USB host (500 mA)", async () => {
  assert.equal(U.plug(true), true);
  await waitLog(/USB plugged in/, 10000, "plug message");
  assert.equal(P.cable(), "usb"); assert.ok(P.isCharging());
  assert.ok(U.up());
});
await check("console over the cable: what the Dot logs reaches the computer, and also the page's console", async () => {
  takeCable();
  await press(BTN.TOP);
  await a.waitFor(() => /battery: \d+%/.test(cableText()), 8000, "battery line on the cable");
  assert.match(log(), /battery: \d+%/);
});
await check("typed lines reach the Dot's console (line editor echoes them); help answers `>|` records on the cable", async () => {
  takeCable();
  U.send("ping\r\n");
  await a.waitFor(() => /ping/.test(cableText()), 5000, "echo of ping");
  await a.waitFor(() => />\|pong[\s\S]*>ok/.test(cableText()), 5000, ">|pong then >ok");
});
await check("the connector is shared: the power area's charger and the computer cannot both be in", async () => {
  U.plug(false); await waitLog(/USB unplugged/, 10000, "unplug");
  P.plug(true, "adapter"); await a.waitFor(() => P.cable() === "adapter", 3000, "adapter in");
  assert.equal(U.plug(true), false, "refused: port taken");
  assert.equal(P.cable(), "adapter");
  P.plug(false); await sleep(300);
  assert.equal(U.plug(true), true);
});
await check("unplug: VBUS goes, charging stops, the Dot sees it (log), the computer's ring is emptied", async () => {
  U.plug(false);
  await waitLog(/USB unplugged/, 10000, "unplug message");
  assert.equal(P.charging(), "none"); assert.equal(U.up(), false);
  assert.equal(U.stats().txPending, 0);
});
await check("a plain charger (no computer): VBUS and charging, but no console peer: output is discarded", async () => {
  assert.equal(U.plug(true, { host: false }), true);
  await a.waitFor(() => P.cable() === "adapter", 3000, "adapter");
  assert.equal(U.up(), false);
  takeCable(); await press(BTN.TOP); await sleep(500);
  assert.equal(takeCable(), "");
  U.plug(false);
});
await check("the 8 KB RX ring drops what a host sends ahead (the hardware does the same)", async () => {
  U.plug(true);
  const before = U.stats();
  const taken = U.send(new Uint8Array(20000).fill(0x20));
  const s = U.stats();
  assert.ok(taken <= 8192 + 4096 && s.rxDropped > 0 || taken < 20000, `taken ${taken}, dropped ${s.rxDropped}, ring free before ${before.rxFree}`);
});
G.stop(); a.shutdown(); finish("usb cable", st);
