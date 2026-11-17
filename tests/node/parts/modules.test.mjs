// Kode modules on the Dot's header: the mount mechanism (upright and turned, one at a time, layout), Maker sockets, Robotics driver, and a real
// Dot app (apps/parts_robotics) driving two DC motors and a servo through the Robotics module. Camera, Mesh and the hacking module are shape only.
import { check, finish, test, loadLibrary, rig, sleep } from "./rig.mjs";
import { Bench } from "../../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../../runtime/web-adapter/bench-clock.js";

const mk = async () => { const b = new Bench({ clock: new BenchClock({ mode: "stepped" }) }); await loadLibrary(b); return b; };
const near = (x, y, t) => Math.abs(x - y) <= t;
const out = (b, i, n) => b.parts.get(i).outputs[n];
const same = (b, x, y) => b.net(x).id === b.net(y).id;
const W = (b, pairs) => pairs.map(([x, y]) => b.connect(x, y));
const ms = (b, n) => b.advance(n * 1000);

await test("mount: only module parts mount, one at a time, upright or turned, unmount frees the header", async () => {
  const b = await mk(), led = b.addPart("dotbench.led-red"), m = b.addPart("dotbench.kode-maker"), r = b.addPart("dotbench.kode-robotics");
  let e1 = null, e2 = null, e3 = null;
  try { b.mountPart(led); } catch (e) { e1 = e.message; }
  check(/does not mount/.test(e1 ?? ""), "a plain part has no mount table and is refused", e1);
  check(b.mountPart(m) === "upright" && b.mounted().instance === m && b.state().parts.find((p) => p.instance === m).mount.orientation === "upright", "Maker mounts upright by default and state() says so");
  try { b.mountPart(r); } catch (e) { e2 = e.message; }
  check(/already mounted/.test(e2 ?? ""), "a second module is refused while Maker is on (only one at a time)", e2);
  try { b.mountPart(m, "sideways"); } catch (e) { e3 = e.message; }
  check(!!e3, "an orientation the part does not list is refused", e3);
  b.unmountPart(m); check(!b.mounted() && !same(b, m + ".S1", "device.EXP1"), "unmounted: the sockets are no longer the Dot's pins");
  b.mountPart(r, "turned"); check(b.mounted().orientation === "turned", "Robotics mounts turned");
  const cam = b.addPart("dotbench.kode-mesh-shape"); b.unmountPart(r);
  let e4 = null; try { b.mountPart(cam, "turned"); } catch (e) { e4 = e.message; }
  check(!!e4 && b.mountPart(cam) === "upright", "a module on the interposer (Mesh) cannot be turned, only upright", e4);
  b.dispose();
});

await test("Maker: sockets follow the documented GPIO order, turned maps p to 15 - p, rails and the 5 V hazard", async () => {
  const b = await mk(), m = b.addPart("dotbench.kode-maker"), hz = [];
  b.on("hazard", (h) => hz.push(h.class));
  b.mountPart(m); b.setRails({ V33: true, V5: true }); await ms(b, 5);
  // socket k meets position: 1..8 as they are, 9..14 are GPIO20, 19, 18, 17, 16, 15 = positions 10, 9, 12, 11, 14, 13
  const pos = [1, 2, 3, 4, 5, 6, 7, 8, 10, 9, 12, 11, 14, 13];
  check(pos.every((p, k) => same(b, `${m}.S${k + 1}`, `device.EXP${p}`)), "sockets 9 to 14 are GPIO20, 19, 18, 17, 16, 15 (positions 10, 9, 12, 11, 14, 13)");
  check(same(b, m + ".GL_1", "device.GND") && same(b, m + ".GR_4", "device.GND") && near(b.net(m + ".V5_3").mv, 5000, 150) && near(b.net(m + ".V33_2").mv, 3300, 150), "GND strips are the Dot's GND, the 5 V strip is 5 V and the 3.3 V strip 3.3 V");
  check(same(b, m + ".a4", m + ".d4") && !same(b, m + ".a4", m + ".f4") && same(b, m + ".f4", m + ".j4"), "the breadboard strips of five are joined, the centre channel splits them");
  const led = b.addPart("dotbench.led-red"), r = b.addPart("dotbench.resistor", { fields: { ohms: 330 } });
  W(b, [[m + ".S5", r + ".A"], [r + ".B", led + ".A"], [led + ".K", m + ".GL_2"]]);
  b.setDevicePin(4, { mode: "out", level: 1 }); await ms(b, 5);
  check(out(b, led, "brightness") > 0.1, "driving the Dot's position 5 lights the LED wired to socket 5 (the Kode Blink example)", out(b, led, "current_ma"));
  b.mountPart(m, "turned"); await ms(b, 5);
  check(out(b, led, "brightness") === 0 && same(b, m + ".S5", "device.EXP10") && same(b, m + ".S9", "device.EXP5") && same(b, m + ".V5_1", "device.V5"), "turned: the same Dot pin no longer reaches socket 5 (socket 5 now meets position 10), power stays on its pins");
  W(b, [[m + ".V5_4", m + ".S1"]]); await ms(b, 5);
  check(hz.includes("overvoltage"), "a 5 V strip wired to a GPIO socket raises an overvoltage hazard (3.3 V pins)", hz);
  const lay = JSON.parse(JSON.stringify(b.serialise())), c = await mk(); const res = await c.restore(lay);
  check(c.mounted()?.orientation === "turned" && !res.missing.length, "serialise and restore keep the module mounted and turned");
  b.dispose(); c.dispose();
});

await test("Robotics: nSLEEP, inputs, turned map, I2C pull-ups, nFAULT, assumed-pin marking", async () => {
  const b = await mk(), r = b.addPart("dotbench.kode-robotics"), mot = b.addPart("dotbench.dc-motor");
  b.mountPart(r); b.setRails({ V33: true, V5: true });
  W(b, [[mot + ".M1", r + ".MOTA_1"], [mot + ".M2", r + ".MOTA_2"]]);
  b.setDevicePin(9 - 1, { mode: "out", level: 0 }); b.setDevicePin(10 - 1, { mode: "out", level: 1 }); await ms(b, 5);   // nSLEEP (pos 9) low, AIN1 (pos 10) high
  check(out(b, mot, "speed") === 0, "asleep: AIN1 high turns nothing");
  b.setDevicePin(9 - 1, { mode: "out", level: 1 }); await ms(b, 10);
  check(out(b, mot, "speed") > 0.5, "nSLEEP high: motor A runs forward", out(b, mot, "speed"));
  b.setDevicePin(10 - 1, { mode: "out", level: 0 }); b.setDevicePin(8 - 1, { mode: "out", level: 1 }); await ms(b, 10);
  check(out(b, mot, "speed") < -0.5, "AIN2 instead of AIN1: reverse", out(b, mot, "speed"));
  b.setDevicePin(8 - 1, { mode: "out", level: 0 }); b.setDevicePin(10 - 1, { mode: "out", pwm: true, hz: 20000, duty: 0.5, level: 1 }); await ms(b, 10);
  check(out(b, mot, "speed") > 0.2 && out(b, mot, "speed") < 0.9, "20 kHz PWM on AIN1 gives a part speed (the duty average)", out(b, mot, "speed"));
  check(near(b.net(r + ".J403_SDA").mv, 3300, 120) && same(b, r + ".J403_SDA", "device.EXP2") && same(b, r + ".J404_17", "device.EXP11") && same(b, r + ".J402_SIG", "device.EXP4"), "the I2C port has its 2.2 kohm pull-ups to 3.3 V; SDA is GPIO9, servo is GPIO11, the sensor header GPIO17 (positions 2, 4, 11)");
  check(near(b.net(r + ".NFAULT").mv, 3300, 250), "nFAULT idles high (pull-up)");
  b.mountPart(r, "turned"); b.setDevicePin(10 - 1, { mode: "z" }); b.setDevicePin(6 - 1, { mode: "out", level: 1 }); b.setDevicePin(5 - 1, { mode: "out", level: 1 }); await ms(b, 10);
  check(same(b, r + ".NSLEEP", "device.EXP6") && same(b, r + ".AIN1", "device.EXP5") && out(b, mot, "speed") > 0.5, "turned: nSLEEP is position 6 and AIN1 position 5 (p becomes 15 - p) and the motor runs from there", out(b, mot, "speed"));
  const m = b.parts.get(r).def.manifest;
  check(m.mount.pins.every((e) => e.source === "documented") && /ASSUMED/.test(m.description.en) && /ASSUMIDO/.test(m.description["pt-BR"]) && m.body.estimate === true, "the manifest marks what is assumed (description in 3 languages, estimate flag) and the mount table is data");
  b.dispose();
});

await test("shape-only modules mount and pass the rails, nothing else", async () => {
  const b = await mk();
  for (const [id, pin, pos] of [["kode-camera-shape", "SCL", 1], ["kode-mesh-shape", "LORA_MOSI", 11], ["kode-hacking-shape", "CC1101_CS", 9]]) {
    const p = b.addPart("dotbench." + id); b.mountPart(p); b.setRails({ V33: true });
    await ms(b, 3);
    check(same(b, `${p}.${pin}`, `device.EXP${pos}`) && same(b, p + ".GND", "device.GND") && near(b.net(p + ".V33").mv, 3300, 150), `${id}: ${pin} is the Dot's position ${pos} and the rails pass through`);
    check(/SHAPE ONLY/.test(b.parts.get(p).def.manifest.description.en) && /shape only/.test(b.parts.get(p).def.manifest.name.en), `${id} says in its name and description that it does nothing`);
    b.unmountPart(p);
  }
  b.dispose();
});

await test("parts_robotics: a Dot app drives two DC motors and a servo through the Robotics module", async () => {
  const r = await rig("parts_robotics"), b = r.bench;
  const rob = b.addPart("dotbench.kode-robotics"), ma = b.addPart("dotbench.dc-motor"), mb = b.addPart("dotbench.dc-motor"), sv = b.addPart("dotbench.servo");
  b.mountPart(rob);
  W(b, [[ma + ".M1", rob + ".MOTA_1"], [ma + ".M2", rob + ".MOTA_2"], [mb + ".M1", rob + ".MOTB_1"], [mb + ".M2", rob + ".MOTB_2"],
    [sv + ".V5", rob + ".J402_V5"], [sv + ".GND", rob + ".J402_GND"], [sv + ".SIG", rob + ".J402_SIG"]]);
  b.setUsbPower(true);                                 // on USB the 5 V rail is there (the app also asks for it, which is how a battery-powered Dot gets it)
  await r.start();
  await r.waitLog(/parts_robotics up/, 30000);
  const m0 = r.mark();
  await r.waitLog(/phase motor A forward/, 10000, m0);
  await r.until(() => out(b, ma, "speed") > 0.3 && out(b, mb, "speed") === 0, 5000, "motor A forward, B still");
  check(true, "phase 1: motor A runs forward (60 % PWM at 20 kHz on AIN1), motor B is still");
  await r.until(() => out(b, mb, "speed") < -0.3 && out(b, ma, "speed") === 0, 5000, "motor B reverse");
  check(true, "phase 2: motor B runs in reverse, motor A stopped");
  await r.until(() => near(out(b, sv, "angle"), 83, 3), 5000, "servo 83");
  check(true, "the servo follows 50 Hz at 7 % (1.4 ms) to about 83 degrees through the module's J402");
  await r.until(() => near(out(b, sv, "angle"), 180, 1), 5000, "servo 180");
  check(out(b, ma, "speed") === 0 && out(b, mb, "speed") === 0, "phase 3: the driver is put to sleep with AIN1 high and nothing moves, the servo goes to 180");
  r.close();
});

process.exit(finish("modules"));
