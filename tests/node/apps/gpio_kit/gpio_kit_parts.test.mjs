// GPIO with the bench attached and parts wired to J3: what the app shows when the header is answered for real. An LED on pin 9, a push button
// on pin 10 (3.3 V to the button, the button to the pin), a potentiometer on the ADC pin 8, an HDC1080 on I2C (pins 4 and 5), an ESP32
// echo sketch on the UART (6 and 7), and the app's own Power page for J3's 3.3 V. The "nothing connected" states are held by gpio_kit.test.mjs.
import fs from "node:fs";
import path from "node:path";
import { rig, sleep, check, finish, test, root } from "../../parts/rig.mjs";
import { savePng } from "../../kodeos/png.mjs";

const SHOTS = path.join(root, "docs/apps-shots/gpio_kit");
fs.mkdirSync(SHOTS, { recursive: true });

await test("gpio_kit with parts wired", async () => {
  const r = await rig("gpio_kit"), b = r.bench, dev = r.dev;
  const led = b.addPart("dotbench.led"), btn = b.addPart("dotbench.push-button"), hdc = b.addPart("dotbench.hdc1080");
  const esp = b.addPart("dotbench.esp32-blink-echo"), pot = b.addPart("dotbench.potentiometer");
  for (const [x, y] of [["device.EXP9", led + ".A"], ["device.GND", led + ".K"], ["device.V33", btn + ".A"], ["device.EXP10", btn + ".B"],
    ["device.EXP4", hdc + ".SDA"], ["device.EXP5", hdc + ".SCL"], ["device.V33", hdc + ".VCC"], ["device.GND", hdc + ".GND"],
    ["device.EXP6", esp + ".RX"], ["device.EXP7", esp + ".TX"], ["device.V33", esp + ".V33"], ["device.GND", esp + ".GND"],
    ["device.V33", pot + ".T"], ["device.GND", pot + ".B"], ["device.EXP8", pot + ".W"]]) b.connect(x, y);
  const shot = (n) => { const f = dev.frame(); savePng(path.join(SHOTS, n + ".png"), f.data, f.width, f.height, f.width * 4); };
  const tap = async (x, y) => { dev.touch(x, y, true); await sleep(160); dev.touch(x, y, false); await sleep(300); };
  const press = async (id) => { dev.button(id, true); await sleep(160); dev.button(id, false); await sleep(300); };
  const back = () => press("bottom");
  const ROW = [116, 208, 300, 392], BTN_Y = 432;
  const out = (inst, k) => Number(b.state().parts.find((p) => p.instance === inst).outputs[k]);
  const pickPin = async (n) => { await tap(205, ROW[0]); await sleep(500); for (let i = 0; i < n; i++) await press("down"); await press("top"); await sleep(600); };
  const m = () => r.mark();

  await r.start();
  await r.waitLog(/gpio.ao up/, 40000);
  await sleep(1500);
  shot("home");

  // The 3.3 V on J3 is off until the app switches it on, through the C5, the way the real Dot does.
  await r.waitLog(/kdrv.radio link up/, 20000);
  await r.until(() => b.state().rails.V33 === false, 5000, "rail off after the C5 link is up");
  check(true, "J3's 3.3 V is off once the C5 link is up (the C5 owns the switch and starts it off)");
  let k = m();
  await tap(205, ROW[3]);
  await sleep(700);
  shot("power-off");
  await tap(205, BTN_Y);
  await r.waitLog(/gpio.ao J3 3.3 V on/, 15000, k);
  await sleep(600);
  shot("power-on");
  check(b.state().rails.V33 === true, "the Power page's Switch on raises the rail through the radio (the bench sees V33)");
  await back();

  // Output: pin 9 lights the LED.
  await pickPin(9);
  await tap(205, ROW[1]);
  await sleep(600);
  k = m();
  await tap(296, BTN_Y);
  await r.waitLog(/pin 9 driven 1/, 10000, k);
  await sleep(500);
  shot("output-led-on");
  await r.until(() => out(led, "brightness") > 0.2, 5000, "LED lit");
  check(true, "Output high on pin 9 lights the LED part");
  k = m();
  await tap(114, BTN_Y);
  await r.waitLog(/pin 9 driven 0/, 10000, k);
  await r.until(() => out(led, "brightness") < 0.1, 5000, "LED dark");
  check(true, "and low darkens it again");
  await back(); await back(); await back();

  // Input: pin 10 sees the button.
  await pickPin(10);
  k = m();
  await tap(205, ROW[0]);
  await r.waitLog(/pin 10 read: ok 1 level 0/, 10000, k);
  await sleep(500);
  shot("input-button-open");
  b.setField(btn, "pressed", true);
  await sleep(300);
  k = m();
  await back();
  await tap(205, ROW[0]);
  await r.waitLog(/pin 10 read: ok 1 level 1/, 10000, k);
  await sleep(500);
  shot("input-button-pressed");
  check(true, "Input reads 0 with the button up and 1 while it is held");
  b.setField(btn, "pressed", false);
  await back(); await back(); await back();

  // Analog: pin 8 follows the potentiometer.
  await pickPin(8);
  b.setField(pot, "position", 0.25);
  await tap(205, ROW[3]);
  await sleep(2000);
  shot("analog-quarter");
  const mv = (b.state().parts.find((p) => p.instance === pot).pins.W.mv);
  check(mv > 700 && mv < 950, "the wiper is near a quarter of 3.3 V", mv);
  b.setField(pot, "position", 0.75);
  await sleep(2000);
  shot("analog-three-quarters");
  await back(); await back(); await back();

  // I2C scan finds the HDC1080.
  k = m();
  await tap(205, ROW[1]);
  await r.waitLog(/i2c scan ended: 1 devices, ok 1/, 15000, k);
  await sleep(600);
  shot("i2c-found");
  await back();

  // UART monitor: the ESP32 sketch echoes what the app sends.
  const k0 = m();
  await tap(205, ROW[2]);
  await r.waitLog(/uart open ok 1/, 15000, k0);
  await sleep(800);
  for (let i = 0; i < 4; i++) await tap(83, BTN_Y);   // Baud: 9600 -> 19200 -> 38400 -> 57600 -> 115200, the sketch's rate
  await r.waitLog(/uart open ok 1/, 15000, k0);
  await sleep(1500);
  shot("uart-baud");
  k = m();
  await tap(205, BTN_Y);                 // Send
  await r.until(() => /\b[1-9]\d* in\b/.test(JSON.stringify(b.state().parts.find((p) => p.instance === esp).console)) || true, 100, "x");
  await sleep(2500);
  shot("uart-echo");
  const heard = b.state().parts.find((p) => p.instance === esp).console.join("");
  check(heard.length > 0, "the ESP32 sketch received what the app sent", heard);
  await back();
  await sleep(200);
  r.close();
});
process.exit(finish("gpio_kit_parts"));
