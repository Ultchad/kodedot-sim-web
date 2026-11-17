// Bluetooth: the real app against the real Bluetooth stack (the BLE area's NimBLE host over the radio core), with bench Sensors in the air:
// the listen, the list strongest first with address and signal bars, a device's page, the empty list, and what the app says when the radio is
// powered off. Nothing is replaced: the answers come from kode_ble_scan() as on the Dot. (The "busy" and "off in Settings" pages need the radio
// busy with another job or Bluetooth switched off in kodeOS's Settings: not reachable from an app, so those two are not screenshotted here.)
import assert from "node:assert/strict";
import * as radioGlue from "../../../../runtime/drivers/radio/radio.js";
import * as bleGlue from "../../../../runtime/drivers/ble/ble.js";
import { Bench, launch, build, runner, BTN, storeShots } from "../lib.mjs";

const T = runner("ble_kit");
const ROW = [116, 208, 300, 392];
const BTN_Y = 432;
const pkg = build("ble_kit");
const bench = await new Bench().open();
const app = await launch(bench, pkg, { name: "ble_kit", glue: { radio: radioGlue, ble: bleGlue } });
const radio = app.glue.radio, ble = app.glue.ble;
radio.fastTiming?.();
const back = async () => { await app.press(BTN.BOT); await app.settle(600); };
const count = (re) => (app.log().match(re) || []).length;
const lit = (x, y) => app.px(x, y) !== 0;
const ink = (x0, y0, x1, y1) => { for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (app.px(x, y) !== 0) return true; return false; };
/** Tap `at`, wait for the listen that follows to end (waitFor polls, which also runs the BLE glue's clock). */
async function listen(at) {
  const n = count(/listen ended/g);
  await app.tap(205, at);
  await app.settle(400);
  return n;
}
/** From Nearby with a heard list of `k` devices: focus "Scan again" (the row after the devices) and press it. */
async function rescan(k) {
  await app.tap(205, ROW[0]);               // the heard list, without listening
  await app.settle(600);
  const n = count(/listen ended/g);
  for (let i = 0; i < k + 1; i++) { await app.press(BTN.DOWN); await app.settle(100); }
  await app.press(BTN.TOP);
  await app.settle(400);
  return n;
}
const listened = async (n) => { await app.waitFor(() => count(/listen ended/g) > n, 30000, "the listen to end"); await app.settle(900); };
const lastEnd = () => (app.log().match(/listen ended: .*/g) || []).pop();

await app.waitFor(() => app.log().includes("ble.ao up"), 30000, "boot");
await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
// the real condition for "Bluetooth is ready to listen": the host has synced with the C5 and advertises
await app.waitFor(() => ble.state().adv.on, 30000, "the Bluetooth host to come up");
await app.settle(600);
ble.addSensor({ name: "Kitchen", rssi: -58, temperature: 21.5 });
ble.addSensor({ name: "Garage", rssi: -81, nameIn: "rsp", mfg: "e5020a0b", services: [0x181a] });
const far = ble.addSensor({ name: "Far away", rssi: -70, inRange: false });
ble.addSensor({ name: "", rssi: -66, nameIn: "adv" });

await T.check("boots to Nearby", async () => {
  await app.shot("home");
  assert.ok(app.stats().colours > 20 && lit(100, ROW[0]) && !lit(100, ROW[1]));
});

await T.check("Listening shows a wait with Cancel, and the Sensors in range are heard strongest first (not the one out of range)", async () => {
  const n = await listen(ROW[0]);
  await app.shot("listening");
  assert.ok(lit(205, BTN_Y) && lit(205, 140), "the disc and Cancel");
  await listened(n);
  await app.shot("list");
  assert.ok(/listen ended: 3 devices, fail 0/.test(lastEnd()), lastEnd());
  for (const y of ROW.slice(0, 3)) assert.ok(lit(100, y), "three rows");
  await back();
});

await T.check("A device's page shows name, address and signal; a Sensor with no name is shown as Unnamed", async () => {
  await app.tap(205, ROW[0]);               // the heard list again, without listening
  await app.settle(600);
  await app.tap(205, ROW[0]);               // Kitchen, the strongest
  await app.settle(700);
  await app.shot("device");
  assert.ok(lit(205, BTN_Y) && ink(32, 108, 300, 134) && ink(32, 180, 300, 210) && ink(32, 254, 300, 284), "name, address and signal");
  await back();
  await app.tap(205, ROW[1]);               // Sensor/unnamed: the second strongest
  await app.settle(700);
  await app.shot("device-second");
  await back();
  await back();
});

await T.check("A Sensor that comes into range is heard on the next listen, with four devices", async () => {
  far.update({ inRange: true });
  const n = await rescan(3);
  await listened(n);
  assert.ok(/listen ended: 4 devices, fail 0/.test(lastEnd()), lastEnd());
  await app.shot("list-four");
  for (const y of ROW) assert.ok(lit(100, y), "four rows");
  await back();
  await app.shot("home-heard");
});

await T.check("With nothing advertising the app says so, and Scan again asks again", async () => {
  for (const s of ble.sensors()) s.remove();
  const n = await rescan(4);
  await listened(n);
  await app.shot("empty");
  assert.ok(/listen ended: 0 devices, fail 0/.test(lastEnd()), lastEnd());
  assert.ok(lit(205, BTN_Y), "Scan again");
  ble.addSensor({ name: "Back again", rssi: -50 });
  const m = count(/listen ended/g);
  await app.tap(205, BTN_Y);
  await listened(m);
  assert.ok(/listen ended: 1 devices, fail 0/.test(lastEnd()), lastEnd());
  await back();
});

await T.check("With the C5 powered off the radio refuses: 'Bluetooth is not available', and once it is back a listen hears again", async () => {
  radio.setPower(false);
  await app.settle(1500);
  const m0 = await rescan(1);
  await listened(m0);
  await app.shot("unavailable");
  assert.ok(/listen ended: 0 devices, fail 3/.test(lastEnd()), lastEnd());
  assert.ok(lit(205, BTN_Y), "Try again");
  radio.setPower(true);
  await app.waitFor(() => ble.state().adv.on, 40000, "Bluetooth to come back with the radio");
  await app.settle(800);
  const m = count(/listen ended/g);
  await app.tap(205, BTN_Y);
  await listened(m);
  assert.ok(/listen ended: 1 devices, fail 0/.test(lastEnd()), lastEnd());
  await app.shot("recovered");
  await back();
});

storeShots(app, ["home-heard", "list-four", "device", "listening"]);
app.run.shutdown();
process.exit(T.done());
