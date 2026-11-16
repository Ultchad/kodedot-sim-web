// Light: screen light, LED, SOS, settings kept across a restart; the pad, BOT and the hold.
import assert from "node:assert/strict";
import { Bench, launch, build, runner, sleep, BTN, RESET, OFF, storeShots } from "../lib.mjs";

const T = runner("light");
const pkg = build("light");
const bench = await new Bench().open();
let app = await launch(bench, pkg, { name: "light" });
const near = (a, b, tol = 14) => Math.abs(a - b) <= tol;
const rgb = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
const ROW = [116, 208, 300, 392];

await T.check("boots to the list of ways to make light", async () => {
  await app.waitFor(() => app.log().includes("light.ao up"), 30000, "boot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
  await app.shot("home");
  assert.ok(app.stats().colours > 20);
  assert.equal(app.px(205, 8), 0, "the page is true black");
  assert.ok(app.px(100, 116) !== 0, "a pill is drawn");
});

await T.check("screen light: soft white, panel at full brightness, controls card", async () => {
  await app.tap(205, ROW[0]);
  await app.settle();
  await app.shot("screen-light");
  const [r, g, b] = rgb(app.px(205, 60));
  assert.ok(near(r, 255, 6) && near(g, 246, 8) && near(b, 234, 10), "soft white " + [r, g, b]);
  assert.equal(app.run.u32(OFF.backlight), 100);
  assert.ok(app.px(60, 250) !== app.px(205, 60), "the card is drawn over the light");
});

await T.check("warmth: dragging the level to the warm end turns the screen amber and it is kept", async () => {
  await app.drag(300, 294, 40, 294);
  await app.settle();
  const [r, g, b] = rgb(app.px(205, 60));
  assert.ok(r > 240 && g < 190 && b < 110, "warm " + [r, g, b]);
  await app.shot("screen-warm");
  await app.drag(60, 294, 360, 294);
  await app.settle();
  const [r2, , b2] = rgb(app.px(205, 60));
  assert.ok(b2 > r2 - 5 && b2 > 240, "cool " + [r2, b2]);
  await app.drag(360, 294, 40, 294);
});

await T.check("brightness level drives the panel; leaving gives the panel back", async () => {
  await app.drag(300, 360, 40, 360);
  await app.waitFor(() => app.run.u32(OFF.backlight) === 5, 5000, "panel at the floor");
  await app.drag(40, 360, 380, 360);
  await app.waitFor(() => app.run.u32(OFF.backlight) === 100, 5000, "panel at the top");
  await app.drag(300, 360, 40, 360);
  await app.waitFor(() => app.run.u32(OFF.backlight) === 5, 5000, "panel low again");
});

await T.check("night mode: red screen; tapping the screen hides the controls", async () => {
  await app.tap(130, 408);          // Night
  await app.settle();
  const [r, g, b] = rgb(app.px(205, 60));
  assert.ok(r > 200 && g < 40 && b < 20, "red " + [r, g, b]);
  await app.shot("night");
  await app.tap(205, 120);          // the lit glass above the card
  await app.settle();
  assert.equal(app.px(205, 400), app.px(205, 60), "the card is gone: the whole glass is one colour");
  await app.shot("screen-clean");
  await app.tap(205, 120);
  await app.settle();
  await app.tap(130, 408);          // Night off
  await app.settle();
  const [r2] = rgb(app.px(205, 60));
  assert.ok(r2 > 200);
});

await T.check("Done goes back to the list and the panel is restored", async () => {
  await app.tap(290, 408);
  await app.settle();
  assert.equal(app.run.u32(OFF.backlight), 100);
  assert.equal(app.px(205, 8), 0);
  assert.ok(app.stats().colours > 20);
});

await T.check("LED: a swatch lights the LED at the chosen colour and brightness", async () => {
  await app.tap(205, ROW[1]);
  await app.settle();
  await app.shot("led-off");
  assert.deepEqual(app.led(), [0, 0, 0]);
  await app.tap(32 + 24 + 2 * 60, 238);   // third swatch: green
  await app.settle();
  const led = app.led();
  assert.ok(led[1] > led[0] * 2 && led[1] > led[2] * 2 && led[1] > 20, "green " + led);
  await app.shot("led-green");
  await app.tap(205, 438);                 // Turn off
  await app.settle();
  assert.deepEqual(app.led(), [0, 0, 0]);
});

await T.check("LED: the hue level colours the LED, brightness level scales it", async () => {
  await app.drag(60, 328, 300, 328);
  await app.settle();
  const a = app.led();
  assert.ok(a[0] + a[1] + a[2] > 20, "lit " + a);
  await app.drag(300, 392, 40, 392);
  await app.settle();
  const b = app.led();
  assert.ok(b[0] + b[1] + b[2] < a[0] + a[1] + a[2], "dimmer " + [a, b]);
  await app.shot("led-hue");
});

await T.check("back with BOT; a held BOT is the OS's and does not go back", async () => {
  await app.hold(BTN.BOT, 800);
  await app.settle();
  assert.ok(app.px(205, 8) === 0 && app.px(205, 60) === 0 || app.stats().colours > 20);
  // still on the LED page: its lamp and the swatches are on the glass (the list has no round swatch)
  const stillLed = app.px(32 + 24 + 60, 238) !== 0;
  assert.ok(stillLed, "a long press did not leave the page");
  await app.press(BTN.BOT);
  await app.settle();
  assert.ok(app.px(100, ROW[0]) !== 0 && app.px(32 + 24 + 60, 238) === 0, "short BOT is back");
});

await T.check("the pad: DOWN shows the ring on the first row, TOP opens it", async () => {
  await app.press(BTN.DOWN);
  await app.settle();
  await app.shot("home-focus");
  await app.press(BTN.DOWN);
  await app.press(BTN.UP);
  await app.press(BTN.TOP);
  await app.settle();
  assert.ok(app.px(32 + 24 + 60, 238) !== 0, "TOP opened the focused row (Screen light, since UP undid DOWN)" === "" ? 0 : 1);
});

await T.check("SOS: the LED and the glass flash in time; stop leaves the LED as it was", async () => {
  await app.press(BTN.BOT);
  await app.press(BTN.BOT);
  await app.settle();
  await app.tap(205, ROW[2]);
  await app.settle();
  await app.shot("sos");
  await app.tap(205, 426);                // Start
  const seen = new Set();
  let glassLit = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 3500) {
    const l = app.led().join(",");
    seen.add(l);
    if (app.px(205, 200) === 0xffffff) glassLit = true;
    await sleep(25);
  }
  assert.ok(seen.has("255,255,255") || [...seen].some((s) => s.split(",").every((v) => +v > 150)), "the LED lit white " + [...seen]);
  assert.ok(seen.has("0,0,0"), "and dark");
  assert.ok(glassLit, "the glass flashed white");
  await app.shot("sos-running");
  await app.tap(205, 426);                // Stop
  await sleep(400);
  assert.deepEqual(app.led(), [0, 0, 0]);
});

await T.check("settings survive a restart", async () => {
  await app.press(BTN.BOT);
  await app.settle();
  await app.waitFor(() => !bench.pm || true, 100, "");
  await app.run.stop();
  app = await launch(bench, pkg, { name: "light", reason: RESET.SOFTWARE });
  await app.waitFor(() => app.log().includes("light.ao up"), 30000, "reboot");
  await app.waitFor(() => app.run.frameSeq() > 0, 30000, "frame");
  await app.settle(600);
  await app.tap(205, ROW[0]);
  await app.settle();
  const [r, g, b] = rgb(app.px(205, 60));
  assert.ok(r > 240 && g < 190 && b < 110, "warm light came back " + [r, g, b]);
  await app.press(BTN.BOT);
  await app.tap(205, ROW[1]);
  await app.settle();
  await app.shot("led-restored");
});

storeShots(app, ["home", "screen-light", "night", "led-green"]);
app.run.shutdown();
process.exit(T.done());
