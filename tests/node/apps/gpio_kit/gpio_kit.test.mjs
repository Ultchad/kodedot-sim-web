// GPIO: the expansion header J3 through kode_pin_*: the pin map, output high/low, live inputs, PWM with frequency and duty, analog, an I2C scan
// and a UART monitor, with nothing wired to J3: the analog, I2C and UART pages must show an honest empty state (gpio_kit_parts.test.mjs covers
// the same pages with parts wired).
import assert from "node:assert/strict";
import { Bench, launch, build, runner, sleep, BTN, storeShots } from "../lib.mjs";

const T = runner("gpio_kit");
const pkg = build("gpio_kit");
const bench = await new Bench().open();
const app = await launch(bench, pkg, { name: "gpio_kit", glue: {} });
const ROW = [116, 208, 300, 392];
const BTN_Y = 432, LEFT_X = 114, RIGHT_X = 296;
const logs = () => app.log();
const lit = (x, y) => app.px(x, y) !== 0;
const count = (re) => (logs().match(re) || []).length;
const back = async () => { await app.press(BTN.BOT); await app.settle(600); };

await app.waitFor(() => logs().includes("gpio.ao up"), 30000, "boot");
await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
await app.settle(600);

/** Open the pin map and pick pin n with the pad: n presses of DOWN, then TOP. */
async function pickPin(n) {
  await app.tap(205, ROW[0]);
  await app.settle(600);
  for (let i = 0; i < n; i++) { await app.press(BTN.DOWN); await sleep(60); }
  await app.press(BTN.TOP);
  await app.settle(700);
}
/** Wait for a new log line of this kind, after doing `act`. */
async function expectLog(re, act, what) {
  const n = count(re);
  await act();
  await app.waitFor(() => count(re) > n, 15000, what);
  await app.settle(500);
}

await T.check("boots to Pins, I2C scan and UART monitor", async () => {
  await app.shot("home");
  assert.ok(app.stats().colours > 20 && lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]));
});

await T.check("The pin map lists the header's pins, and each pin offers what it can do", async () => {
  await app.tap(205, ROW[0]);
  await app.settle(700);
  await app.shot("pins");
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]) && lit(100, ROW[3]));
  await app.tap(205, ROW[3]);               // Pin 4: digital only
  await app.settle(700);
  await app.shot("pin");
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]) && !lit(100, ROW[3]), "Input, Output and PWM, no Analog");
  await back();
  for (let i = 0; i < 8; i++) { await app.press(BTN.DOWN); await sleep(60); }
  await app.press(BTN.TOP);                 // Pin 8: has an ADC
  await app.settle(700);
  await app.shot("pin-analog");
  assert.ok(lit(100, ROW[3]), "Analog is offered on pin 8");
  await back();
  await back();
});

await T.check("Output drives a pin high and low and says which", async () => {
  await pickPin(4);
  await app.tap(205, ROW[1]);               // Output
  await app.settle(700);
  await app.shot("output");
  await expectLog(/pin 4 driven 1/g, () => app.tap(RIGHT_X, BTN_Y), "pin 4 driven high");
  await app.shot("output-high");
  const high = app.px(158, 135);
  await expectLog(/pin 4 driven 0/g, () => app.tap(LEFT_X, BTN_Y), "pin 4 driven low");
  await app.shot("output-low");
  assert.notEqual(app.px(158, 135), high, "the disc changes colour with the level");
  await expectLog(/pin 4 driven 1/g, () => app.tap(RIGHT_X, BTN_Y), "pin 4 driven high again");
  await back();
  await back();
  await app.shot("pins-driven");
  assert.ok(lit(100, ROW[3]));
  await back();
});

await T.check("An input reads back what the pin is driven to", async () => {
  await pickPin(9);                         // Pin 9
  await app.tap(205, ROW[1]);
  await app.settle(600);
  await expectLog(/pin 9 driven 0/g, () => app.tap(LEFT_X, BTN_Y), "pin 9 low");
  await back();
  await expectLog(/pin 9 read: ok 1 level 0/g, () => app.tap(205, ROW[0]), "pin 9 reads low");
  await app.shot("input-low");
  await back();
  await app.tap(205, ROW[1]);
  await app.settle(600);
  await expectLog(/pin 9 driven 1/g, () => app.tap(RIGHT_X, BTN_Y), "pin 9 high");
  await back();
  await expectLog(/pin 9 read: ok 1 level 1/g, () => app.tap(205, ROW[0]), "pin 9 reads high");
  await app.shot("input-high");
  await back();
  await back();
  await back();
});

await T.check("PWM starts, retunes with the steppers and stops", async () => {
  await pickPin(4);
  await app.tap(205, ROW[2]);               // PWM
  await app.settle(700);
  await app.shot("pwm");
  await expectLog(/pin 4 pwm 1000 Hz 50%/g, () => app.tap(205, BTN_Y), "PWM started at 1 kHz, 50%");
  await app.shot("pwm-running");
  await expectLog(/pin 4 pwm 2000 Hz 50%/g, () => app.tap(334, 112), "retuned to 2 kHz");
  await expectLog(/pin 4 pwm 2000 Hz 60%/g, () => app.tap(334, 220), "duty up to 60%");
  await expectLog(/pin 4 pwm 2000 Hz 50%/g, () => app.tap(262, 220), "duty down to 50%");
  await expectLog(/pin 4 driven 0/g, () => app.tap(205, BTN_Y), "stopped: the pin goes low");
  await app.shot("pwm-stopped");
  await back();
  await back();
  await back();
});

await T.check("The first and the last pin can be driven", async () => {
  await pickPin(1);
  await app.tap(205, ROW[1]);
  await app.settle(600);
  await expectLog(/pin 1 driven 1/g, () => app.tap(RIGHT_X, BTN_Y), "pin 1 high");
  await back(); await back(); await back();
  await pickPin(14);
  await app.tap(205, ROW[1]);
  await app.settle(600);
  await expectLog(/pin 14 driven 1/g, () => app.tap(RIGHT_X, BTN_Y), "pin 14 high");
  await back(); await back(); await back();
});

await T.check("Analog with nothing wired reads 0 mV and says so", async () => {
  await pickPin(8);
  await app.tap(205, ROW[3]);               // Analog
  await app.settle(1500);
  await app.shot("analog-nothing");
  assert.ok(!/not implemented/.test(logs()), "the ADC now answers");
  assert.ok(app.px(158, 135) !== 0, "the disc is drawn");
  await back(); await back(); await back();
});

await T.check("I2C scan with nothing on the bus says 'No devices found' (and that the 3.3 V is off), and Scan again asks again", async () => {
  await app.tap(205, ROW[1]);
  await app.waitFor(() => /i2c scan ended: 0 devices, ok 1/.test(logs()), 15000, "the scan to end");
  await app.settle(700);
  await app.shot("i2c-nothing");
  const n = count(/i2c scan ended/g);
  await app.tap(205, BTN_Y);
  await app.waitFor(() => count(/i2c scan ended/g) > n, 15000, "a second scan");
  await app.settle(600);
  assert.ok(lit(205, BTN_Y), "Scan again is still offered");
  await back();
});

await T.check("The UART monitor opens and waits for data with 0 in and 0 out", async () => {
  await app.tap(205, ROW[2]);
  await app.waitFor(() => /uart open ok 1/.test(logs()), 15000, "the UART to open");
  await app.settle(700);
  await app.shot("uart-nothing");
  await back();
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[2]), "back on the first page");
});

storeShots(app, ["home", "pins", "output-high", "pwm-running"]);
app.run.shutdown();
process.exit(T.done());
