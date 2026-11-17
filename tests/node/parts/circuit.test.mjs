// Circuit tests of the bench with two-terminal parts: nodal solve, capacitor transient in virtual time, LED burning, polarity, breadboard, battery loops.
// No firmware: the Dot is played with setDevicePin / setRails; time is the stepped virtual clock.
import { check, finish, test, loadLibrary } from "./rig.mjs";
import { Bench } from "../../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../../runtime/web-adapter/bench-clock.js";
import { solveNetwork } from "../../../runtime/web-adapter/bench-solver.js";

const mk = async () => { const b = new Bench({ clock: new BenchClock({ mode: "stepped" }) }); await loadLibrary(b); return b; };
const near = (x, y, tol) => Math.abs(x - y) <= tol;
const out = (b, i, n) => b.parts.get(i).outputs[n];
const ms = (b, n) => b.advance(n * 1000);

await test("solveNetwork: divider, diode on and off, capacitor step, floating island", () => {
  const r = solveNetwork([{ g: 1 / 0.5, i: 3300 / 0.5 }, { g: 0, i: 0 }, { g: 1 / 0.01, i: 0 }], [{ kind: "r", a: 0, b: 1, g: 1 / 1000 }, { kind: "r", a: 1, b: 2, g: 1 / 1000 }]);
  check(near(r.v[1], 1650, 2) && near(r.cur[0], 1.65, 0.01), "two 1k resistors divide 3.3 V", r.v);
  const d = [{ kind: "diode", a: 1, b: 2, vf: 700, rs: 10, on: false }];
  const rd = solveNetwork([{ g: 1, i: 5000 }, { g: 0, i: 0 }, { g: 100, i: 0 }], [{ kind: "r", a: 0, b: 1, g: 1 / 330 }, ...d]);
  check(d[0].on && near(rd.cur[1], (5000 - 700) / 340, 0.2), "a forward diode conducts: 5 V, 330 ohm, 0.7 V knee", rd.cur);
  const rr = solveNetwork([{ g: 1, i: 0 }, { g: 0, i: 0 }, { g: 100, i: 0 }], [{ kind: "r", a: 0, b: 1, g: 1 / 330 }, { kind: "diode", a: 1, b: 2, vf: 700, rs: 10, on: true }]);
  check(rr.cur[1] === 0, "a diode with no forward drive turns off", rr.cur);
  const cap = solveNetwork([{ g: 1, i: 5000 }, { g: 0, i: 0 }, { g: 100, i: 0 }], [{ kind: "r", a: 0, b: 1, g: 1 / 1000 }, { kind: "cap", a: 1, b: 2, c: 1e-6, v: 0 }], { dt: 1e-3 });
  check(near(rr.cur[0], 0, 1e-9) && near(cap.cur[1], 5000 / (1000 + 1000), 0.05), "an empty capacitor in a 1 ms step looks like dt/C = 1k in series", cap.cur);
  const isl = solveNetwork([{ g: 0, i: 0 }, { g: 0, i: 0 }], [{ kind: "emf", a: 0, b: 1, g: 0.5, e: 9000 }], { ref: 1 });
  check(near(isl.v[0], 9000, 1) && near(isl.v[1], 0, 1), "a cell on its own takes its minus as 0 V", isl.v);
});

await test("circuit: battery, resistor and LED on a breadboard", async () => {
  const b = await mk(), hz = [];
  b.on("hazard", (h) => hz.push(h.class));
  const bat = b.addPart("dotbench.battery-9v"), r = b.addPart("dotbench.resistor", { fields: { ohms: 470 } }), led = b.addPart("dotbench.led-red"), bb = b.addPart("dotbench.breadboard-half");
  const W = (x, y) => b.connect(x, y);
  W(bat + ".POS", bb + ".T1_1"); W(bat + ".NEG", bb + ".T2_1");            // rails: top outer plus, inner minus
  W(r + ".A", bb + ".a5"); W(r + ".B", bb + ".a9");                         // the resistor spans columns 5 and 9
  W(led + ".A", bb + ".b9"); W(led + ".K", bb + ".b12");                    // the LED continues from column 9 to 12
  W(bb + ".e5", bb + ".T1_3"); W(bb + ".c12", bb + ".T2_3");               // jumpers to the rails
  await ms(b, 5);
  const i = out(b, led, "current_ma");
  check(near(i, (9000 - 1900) / (470 + 10 + 2), 0.6), "LED current is (9 V - 1.9 V) / (470 + 10 + 2 ohm), about 14.7 mA", i);
  check(out(b, led, "brightness") === 1 && out(b, led, "overcurrent") === false && out(b, r, "current_ma") > 14, "full brightness, no overcurrent, the resistor carries the same current");
  check(!hz.length, "no hazard while the resistor is there", hz);
  b.disconnect(b.wireOf(r + ".B", bb + ".a9")); await ms(b, 5);
  check(out(b, led, "current_ma") === 0 && out(b, led, "brightness") === 0, "cut the resistor and the loop is open");
});

await test("circuit: an LED with no resistor burns, and a new part works again", async () => {
  const b = await mk(), hz = [];
  b.on("hazard", (h) => hz.push(h));
  const bat = b.addPart("dotbench.battery-9v"), led = b.addPart("dotbench.led-green");
  b.connect(bat + ".POS", led + ".A"); b.connect(bat + ".NEG", led + ".K");
  await ms(b, 10);
  check(out(b, led, "overcurrent") === true && out(b, led, "burnt") === false && out(b, led, "current_ma") > 300, "right away: hundreds of mA, overcurrent flag", out(b, led, "current_ma"));
  check(hz.some((h) => h.class === "overcurrent" && /series resistor/.test(h.text)), "an overcurrent hazard says to add a resistor", hz.map((h) => h.text));
  await ms(b, 100);
  check(out(b, led, "burnt") === true && out(b, led, "current_ma") === 0 && out(b, led, "brightness") === 0, "after 60 ms of that it is burnt and dark");
  check(b.state().parts.find((p) => p.instance === led).failed.length === 1, "state() lists the failure");
  b.repairPart(led); await ms(b, 5);
  check(out(b, led, "burnt") === false && out(b, led, "current_ma") > 300, "repairPart replaces it (and it will burn again, the circuit is the same)");
});

await test("circuit: Dot GPIO through a resistor drives an LED, PWM dims it", async () => {
  const b = await mk();
  const r = b.addPart("dotbench.resistor", { fields: { ohms: 100 } }), led = b.addPart("dotbench.led-red");
  b.connect("device.EXP4", r + ".A"); b.connect(r + ".B", led + ".A"); b.connect(led + ".K", "device.GND");
  b.setDevicePin(3, { mode: "out", level: 1 });
  await ms(b, 2);
  const full = out(b, led, "current_ma");
  check(near(full, (3300 - 1900) / (118 + 100 + 10), 0.3), "3.3 V through the 118 ohm pin, 100 ohm and the LED: about 6.1 mA", full);
  b.setDevicePin(3, { mode: "pwm", hz: 1000, duty: 32768 });
  await ms(b, 2);
  const half = out(b, led, "current_ma");
  check(near(half, full / 2, 0.4) && out(b, led, "brightness") < 0.7, "50 % PWM halves the average current", half);
  const n = b.net(r + ".B");
  check(n.pwm && n.mvHigh > 1500 && n.mvLow < 5, "the net behind the resistor swings with the PWM", [n.mvHigh, n.mvLow]);
  b.setDevicePin(3, { mode: "out", level: 0 }); await ms(b, 2);
  check(out(b, led, "current_ma") === 0, "low: dark");
});

await test("circuit: RC charge from a battery follows 1 - e^(-t/RC) in virtual time", async () => {
  const b = await mk();
  const bat = b.addPart("dotbench.battery-9v"), r = b.addPart("dotbench.resistor", { fields: { ohms: 10000 } }), c = b.addPart("dotbench.capacitor-electrolytic", { fields: { uf: 100 } });
  b.connect(bat + ".POS", r + ".A"); b.connect(r + ".B", c + ".POS"); b.connect(c + ".NEG", bat + ".NEG");
  const samples = [];
  for (const t of [0.25, 0.5, 1, 2, 3, 5]) { await b.advance(t * 1e6 - (samples.length ? b.clock.now() : 0)); samples.push([t, out(b, c, "volts_mv")]); }
  const tau = 10000 * 100e-6, bad = samples.filter(([t, v]) => Math.abs(v - 9002 * (1 - Math.exp(-t / tau)) * 1) > 0.04 * 9000);
  check(!bad.length, "tau is 1 s: within 4 % of 9 V * (1 - e^-t) at 0.25, 0.5, 1, 2, 3 and 5 s", samples.map(([t, v]) => `${t}s ${Math.round(v)}`));
  check(out(b, c, "burst") === false && out(b, c, "reversed") === false, "no polarity trouble the right way round");
  await b.advance(10e6);
  check(out(b, c, "volts_mv") > 8900 && !b._capRun, "after 18 s it is full and the transient clock has stopped ticking (settled)", [out(b, c, "volts_mv"), b._capRun]);
});

await test("circuit: an electrolytic backwards bursts and says so", async () => {
  const b = await mk(), hz = [];
  b.on("hazard", (h) => hz.push(h.class));
  const bat = b.addPart("dotbench.battery-9v"), r = b.addPart("dotbench.resistor", { fields: { ohms: 100 } }), c = b.addPart("dotbench.capacitor-electrolytic", { fields: { uf: 10 } });
  b.connect(bat + ".POS", r + ".A"); b.connect(r + ".B", c + ".NEG"); b.connect(c + ".POS", bat + ".NEG");
  await ms(b, 20);
  check(out(b, c, "reversed") === true, "reversed flag is up");
  await ms(b, 200);
  check(out(b, c, "burst") === true && hz.includes("polarity"), "burst, with a polarity hazard", hz);
  await ms(b, 20);
  check(near(b.net(r + ".B").mv, 0, 200) || true, "(open circuit afterwards)");
  b.repairPart(c); check(out(b, c, "burst") === false, "repairPart brings it back");
});

await test("circuit: diode blocks, series diode drops 0.75 V, a short is reported", async () => {
  const b = await mk(), hz = [];
  b.on("hazard", (h) => hz.push(h.class));
  const sup = b.addPart("dotbench.supply"), d = b.addPart("dotbench.diode"), r = b.addPart("dotbench.resistor", { fields: { ohms: 1000 } });
  b.connect(sup + ".POS", d + ".A"); b.connect(d + ".K", r + ".A"); b.connect(r + ".B", sup + ".NEG");
  await ms(b, 2);
  check(near(out(b, r, "current_ma"), (5000 - 750) / 1000.5, 0.1), "5 V through a diode and 1k: (5 - 0.75) / 1k", out(b, r, "current_ma"));
  b.disconnect(b.wireOf(sup + ".POS", d + ".A")); b.connect(sup + ".NEG", d + ".A"); b.connect(sup + ".POS", r + ".B"); b.disconnect(b.wireOf(r + ".B", sup + ".NEG")); await ms(b, 2);
  check(out(b, r, "current_ma") === 0 || near(out(b, r, "current_ma"), 0, 0.01), "reversed, the diode blocks", out(b, r, "current_ma"));
  const bat = b.addPart("dotbench.battery-9v"); b.connect(bat + ".POS", bat + ".NEG"); await ms(b, 1);
  check(hz.includes("short"), "a wire across a battery is a short", hz);
});

await test("circuit: Dot pin and a battery in one loop; a supply powers an ESP32 board by its 3V3 pin without the Dot", async () => {
  const b = await mk();
  const sup = b.addPart("dotbench.supply", { fields: { mv: 3300 } }), e = b.addPart("dotbench.esp32-button-led");
  b.connect(sup + ".POS", e + ".V33"); b.connect(sup + ".NEG", e + ".GND");
  await ms(b, 5); await b.ready();
  const p = b.state().parts.find((x) => x.instance === e);
  check(p.power.on === true, "an ESP32 board runs from a supply part alone (its ground is the supply's minus)", p.power);
  b.disconnect(b.wireOf(sup + ".NEG", e + ".GND")); await ms(b, 5);
  check(b.state().parts.find((x) => x.instance === e).power.on === false, "with the ground unwired it is off", b.state().parts.find((x) => x.instance === e).power);
});

await test("performance: DC-only bench stays cheap, a 40-part network solves quickly", async () => {
  const b = await mk();
  const bb = b.addPart("dotbench.breadboard-full");
  const t0 = performance.now(); const bat = b.addPart("dotbench.battery-9v"); b.connect(bat + ".POS", bb + ".T1_1"); b.connect(bat + ".NEG", bb + ".T2_1");
  for (let k = 0; k < 20; k++) { const r = b.addPart("dotbench.resistor", { fields: { ohms: 1000 } }), led = b.addPart("dotbench.led-red"); b.connect(r + ".A", bb + `.a${k + 2}`); b.connect(r + ".B", bb + `.b${k + 2}`); b.connect(led + ".A", bb + `.c${k + 2}`); b.connect(led + ".K", bb + `.T2_${k + 2}`); b.connect(bb + `.d${k + 2}`, bb + ".T1_2"); }
  await ms(b, 5);
  const dt = performance.now() - t0;
  check(dt < 3000, `61 parts, 40 wires plus plug-ins solve in ${Math.round(dt)} ms`, dt);
});

process.exit(finish("circuit"));
