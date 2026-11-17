// End to end: real Kode Dot apps (the firmware's own drivers compiled to wasm) against bench parts, over the exp link.
// Own apps: parts_io (LED part + button part), parts_i2c (HDC1080 sensor part), parts_uart (ESP32 part running a real sketch).
// SDK examples: expansion_io (GPIO, PWM, IRQ, ADC on J3) and exp_bus (I2C scan and LM75 read).
import { rig, check, finish, test, sleep } from "./rig.mjs";
import fs from "node:fs";
import path from "node:path";
import { root } from "./rig.mjs";

const wire = (b, pairs) => pairs.map(([x, y]) => b.connect(x, y));
const out = (b, inst, name) => b.state().parts.find((p) => p.instance === inst).outputs[name];

await test("parts_io: the Dot blinks an LED part and reads a button part", async () => {
  const r = await rig("parts_io"), b = r.bench;
  const led = b.addPart("dotbench.led"), btn = b.addPart("dotbench.push-button");
  wire(b, [["device.EXP4", led + ".A"], ["device.GND", led + ".K"], ["device.V33", btn + ".A"], ["device.EXP6", btn + ".B"]]);
  await r.start();
  await r.waitLog(/parts_io up/);
  check(b.state().attached, "the bench is attached to the booted firmware");
  const seen = new Set();
  for (let i = 0; i < 60 && seen.size < 2; i++) { seen.add(out(b, led, "brightness") > 0.1 ? "on" : "off"); await sleep(50); }
  check(seen.has("on") && seen.has("off"), "the LED part is lit and dark in turn as the app toggles EXP4", [...seen]);
  const ok = () => out(b, led, "brightness");
  await r.waitLog(/led 1/); await sleep(30);
  check(b.state().device.pins[3].mode === "out", "the firmware's pin state reaches the bench (EXP4 is an output)");
  let m = r.mark();
  b.setField(btn, "pressed", true);
  await r.waitLog(/button down/, 5000, m);
  check(true, "pressing the button part is seen by kode_pin_read as 'button down'");
  m = r.mark();
  b.setField(btn, "pressed", false);
  await r.waitLog(/button up/, 5000, m);
  check(true, "releasing it is seen as 'button up'");
  // a wire edit while running: cut the LED's ground, it goes dark whatever the app drives
  const gw = b.wireOf("device.GND", led + ".K"); b.disconnect(gw);
  await sleep(300);
  let lit = false; for (let i = 0; i < 10; i++) { if (ok() > 0.05) lit = true; await sleep(30); }
  check(!lit, "a wire removed while running takes effect: with no ground path the LED stays dark");
  b.connect("device.GND", led + ".K");
  r.close();
});

await test("parts_i2c: the Dot reads an HDC1080 sensor part", async () => {
  const r = await rig("parts_i2c"), b = r.bench;
  const s = b.addPart("dotbench.hdc1080");
  wire(b, [["device.EXP4", s + ".SDA"], ["device.EXP5", s + ".SCL"], ["device.V33", s + ".VCC"], ["device.GND", s + ".GND"]]);
  await r.start();
  await r.waitLog(/probe 0x40 yes/, 30000);
  check(true, "kode_i2c_probe finds the sensor at 0x40");
  await r.waitLog(/probe 0x41 no/);
  check(true, "and nothing at 0x41");
  await r.waitLog(/manufacturer 0x5449/);
  check(true, "the manufacturer register reads 0x5449");
  await r.waitLog(/temp raw=0x6285 23\.49 C/);
  check(true, "temperature 23.5 C comes back as raw 0x6285 (23.49 C after the datasheet's conversion)");
  const m = r.mark();
  b.setField(s, "temperature", -10);
  await r.waitLog(/temp raw=0x\w+ (-9\.99|-10\.0\d) C/, 5000, m);
  check(true, "changing the field is visible at the next read (-10 C)");
  b.setField(s, "humidity", 80);
  await r.waitLog(/humidity raw=0x\w+ (79\.9|80\.0) %/, 5000, m);
  check(true, "humidity follows too");
  // unplug SDA: the transfers fail and the app says so
  const mm = r.mark();
  b.disconnect(b.wireOf("device.EXP4", s + ".SDA"));
  await r.waitLog(/no temperature/, 5000, mm);
  check(true, "with SDA unplugged the read fails (the app logs the error)");
  r.close();
});

await test("parts_uart: the Dot exchanges UART with an ESP32 part running a real sketch", async () => {
  const r = await rig("parts_uart"), b = r.bench;
  const e = b.addPart("dotbench.esp32-blink-echo");
  wire(b, [["device.V33", e + ".V33"], ["device.GND", e + ".GND"], ["device.EXP9", e + ".RX"], ["device.EXP10", e + ".TX"]]);
  await r.start();
  await r.waitLog(/parts_uart up/, 30000);
  await r.waitLog(/reply \d+: ping \d+\|?/, 20000);
  check(true, "the sketch echoes what the Dot sends");
  const t = r.text();
  check(/reply 2: ping 2/.test(t) || /reply 3: ping 3/.test(t), "replies keep up with the pings", t.split("\n").filter((l) => /reply/.test(l)).slice(0, 4));
  const st = b.state().parts.find((p) => p.instance === e);
  check(st.power.on && st.outputs.echoed > 0, "the ESP32 part is powered and counted the bytes it echoed", st.outputs);
  check(st.console.some((l) => /echoing UART1/.test(l)), "its console shows the sketch's own Serial output", st.console.slice(0, 3));
  // swap the baud on the wire side: unwire TX, the Dot hears nothing
  b.disconnect(b.wireOf("device.EXP10", e + ".TX"));
  const m = r.mark();
  await r.waitLog(/reply \d+: \(nothing\)/, 8000, m);
  check(true, "with the sketch's TX unplugged the Dot's reads time out");
  r.close();
});

await test("expansion_io (SDK example): LED, PWM, contact and knob on J3 against parts", async () => {
  const r = await rig("expansion_io"), b = r.bench;
  const led = b.addPart("dotbench.led"), srv = b.addPart("dotbench.servo"), btn = b.addPart("dotbench.push-button"), pot = b.addPart("dotbench.potentiometer");
  wire(b, [["device.EXP4", led + ".A"], ["device.GND", led + ".K"],
    ["device.EXP5", srv + ".SIG"], ["device.V5", srv + ".V5"], ["device.GND", srv + ".GND"],
    ["device.EXP6", btn + ".A"], ["device.GND", btn + ".B"],
    ["device.V33", pot + ".T"], ["device.GND", pot + ".B"], ["device.EXP8", pot + ".W"]]);
  b.setRails({ V33: true, V5: true });                 // the example never switches J3's rails itself
  await r.start();
  b.setRails({ V33: true, V5: true });
  await r.waitLog(/took J3: EXP4 LED, EXP5 PWM, EXP6 contact, EXP8 knob at (\d+) \((\d+) mV\)/, 30000);
  const mv0 = +/knob at \d+ \((\d+) mV\)/.exec(r.text())[1];
  check(Math.abs(mv0 - 1650) < 120, "the ADC reads the potentiometer's midpoint (about 1650 mV)", mv0);
  check(/EXP6 contact/.test(r.text()) && b.state().device.pins[5].pull === "up", "EXP6 is an input with the pull-up, as published");
  let m = r.mark();
  b.setField(pot, "position", 1);
  await r.waitLog(/knob (3\d\d\d) mV/, 8000, m);
  check(true, "turning the knob to the top reads about 3.1 V and the example logs it");
  await r.until(() => { const d = b.state().device.pins[4]; return d.mode === "pwm" && d.duty > 0; }, 8000, "PWM on EXP5");
  const ang = () => b.state().parts.find((p) => p.instance === srv).outputs.angle;
  check(b.state().device.pins[4].hz === 1000, "the firmware's PWM (1 kHz) is a property of the net");
  m = r.mark();
  b.setField(btn, "pressed", true);
  await r.waitLog(/EXP6 contact closed \(low\)/, 8000, m);
  check(true, "closing the button part reaches the firmware's IRQ and settle logic");
  b.setField(btn, "pressed", false);
  await r.waitLog(/EXP6 contact opened \(high\)/, 8000, m);
  check(true, "opening it is seen too");
  const levels = new Set();
  for (let i = 0; i < 60 && levels.size < 2; i++) { levels.add(b.state().device.pins[3].level); await sleep(40); }
  check(levels.size === 2, "the example blinks EXP4 on its own: both levels are seen on the bench", [...levels]);
  m = r.mark();
  r.dev.button(4, true); await sleep(150); r.dev.button(4, false);            // the top button stops the blinking
  await r.waitLog(/blinking off, EXP4 low/, 8000, m);
  await sleep(300);
  check(b.state().device.pins[3].level === 0, "after 'blinking off' EXP4 is low on the bench");
  m = r.mark();
  r.dev.button(4, true); await sleep(150); r.dev.button(4, false);
  await r.waitLog(/blinking on/, 8000, m);
  check(true, "and the top button starts it again");
  r.close();
});

await test("exp_bus (SDK example): scan and LM75 read against the starter's no-code sensor", async () => {
  const r = await rig("exp_bus"), b = r.bench;
  const def = JSON.parse(fs.readFileSync(path.join(root, "templates/component-starter/examples/lm75-declarative.manifest.json"), "utf8"));
  def.id = "test.lm75"; def.picture = { file: "p.svg", width: 400, height: 260 };
  // a minimal package: manifest + picture, built the same way `dotbench part build` does
  const { zipPackage, packageFiles } = await import("../../../tools/dblib/part/build.mjs");
  const dir = fs.mkdtempSync(path.join((await import("node:os")).tmpdir(), "lm75-"));
  fs.writeFileSync(path.join(dir, "p.svg"), fs.readFileSync(path.join(root, "templates/component-starter/examples/picture-lm75.svg")));
  const bytes = zipPackage(packageFiles(dir, def, null));
  const d = await b.loadPart(bytes); check(d.ok, "the no-code LM75 example loads as a .dotpart", d.errors);
  const s = b.addPart("test.lm75");
  wire(b, [["device.EXP4", s + ".SDA"], ["device.EXP5", s + ".SCL"], ["device.V33", s + ".VCC"], ["device.GND", s + ".GND"]]);
  b.setRails({ V33: true });
  await r.start(); b.setRails({ V33: true });
  await r.waitLog(/a device answers at 0x48/, 30000);
  check(true, "the bus scan finds the sensor at 0x48");
  await r.waitLog(/1 device\(s\) on the bus/);
  check(true, "and only one device");
  await r.waitLog(/25\.00 C/, 8000);
  check(true, "the first reading is the field's default, 25.00 C");
  const m = r.mark();
  b.setField(s, "temperature", 37.5);
  await r.waitLog(/37\.50 C/, 8000, m);
  check(true, "a field change shows at the next read: 37.50 C");
  r.close();
});

process.exit(finish("e2e_apps"));
