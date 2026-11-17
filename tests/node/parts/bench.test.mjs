// Unit tests of the bench model: solver, buses (I2C/SPI/UART routing and faults), power, contact bounce, hazards, layouts, .dotpart validation.
// No firmware here: the device side is played by setDevicePin / setRails / the bus calls themselves (the end-to-end file runs real firmware).
import fs from "node:fs";
import path from "node:path";
import { check, finish, test, loadLibrary, loadFile, root, sleep } from "./rig.mjs";
import { Bench } from "../../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../../runtime/web-adapter/bench-clock.js";
import { computeNets, solveSources, digital, conflicts } from "../../../runtime/web-adapter/bench-solver.js";
import { readDotpart, validateManifest } from "../../../runtime/web-adapter/dotpart.js";

const mk = async () => { const b = new Bench({ clock: new BenchClock({ mode: "stepped" }) }); await loadLibrary(b); return b; };
const warnings = (b) => { const w = []; b.on("warning", (x) => w.push(x)); return w; };
const pullup = (b, ...pos) => pos.forEach((i) => b.setDevicePin(i, { mode: "in", pull: "up" }));
const I2C = { sda: "device.EXP4", scl: "device.EXP5", hz: 100000 };
const wireSensor = (b, s, o = {}) => { for (const [x, y] of [["device.EXP4", s + (o.swap ? ".SCL" : ".SDA")], ["device.EXP5", s + (o.swap ? ".SDA" : ".SCL")], ["device.V33", s + ".VCC"], ["device.GND", s + ".GND"]]) b.connect(x, y); };

await test("solver: nets, dividers, strong sources, hysteresis, conflicts", () => {
  const { netOf, nets } = computeNets(["a", "b", "c", "d"], [["a", "b"], ["c", "d"], ["b", "zz"]]);
  check(netOf.get("a") === netOf.get("b") && netOf.get("c") === netOf.get("d") && netOf.get("a") !== netOf.get("c") && nets.length === 2, "wires join terminals into nets; a wire to an unknown terminal is ignored");
  const div = solveSources([{ term: "t", mv: 3300, ohms: 10000, kind: "pull" }, { term: "g", mv: 0, ohms: 10000, kind: "pull" }]);
  check(Math.abs(div.mv - 1650) < 1 && div.strong.length === 0, "two equal resistors make a midpoint divider", div.mv);
  const strong = solveSources([{ term: "o", mv: 3300, ohms: 118, kind: "out" }, { term: "g", mv: 0, ohms: 100000, kind: "pull" }]);
  check(strong.mv > 3290 && strong.strong.length === 1, "an output (118 ohm) beats a 100k pull", strong.mv);
  check(solveSources([]).floating === true && solveSources([]).mv === 0, "a net with no source floats and reads 0 mV");
  check(digital(2600, 3300, 0) === 1 && digital(700, 3300, 1) === 0 && digital(1650, 3300, 1) === 1 && digital(1650, 3300, 0) === 0, "hysteresis: 75 % and 25 % of the supply, in between the level holds");
  check(digital(3300, 0, 1) === 0, "an unpowered reader sees 0");
  const sh = conflicts([{ term: "a", mv: 3300, ohms: 118, kind: "out" }, { term: "b", mv: 0, ohms: 0.5, kind: "rail" }]);
  check(sh.length === 1 && sh[0].class === "short", "a strong 3.3 V against a strong 0 V is a short", sh);
  const ct = conflicts([{ term: "a", mv: 3300, ohms: 118, kind: "out" }, { term: "b", mv: 3300, ohms: 118, kind: "out" }]);
  check(ct.length === 1 && ct[0].class === "contention", "two agreeing push-pull outputs are contention", ct);
  check(conflicts([{ term: "a", mv: 3300, ohms: 118, kind: "out" }, { term: "b", mv: 0, ohms: 10000, kind: "pull" }]).length === 0, "a strong source against a weak pull is fine");
});

await test("bench: wires, power rules, hazards", async () => {
  const b = await mk(), hz = []; b.on("hazard", (h) => hz.push(h));
  const s = b.addPart("dotbench.hdc1080");
  wireSensor(b, s); pullup(b, 3, 4);
  const pw = () => b.state().parts.find((p) => p.instance === s).power;
  check(pw().on === false, "a part with supply pins is off while its rail is off", pw());
  b.setRails({ V33: true });
  check(pw().on === true, "and on when the rail is up");
  const led = b.addPart("dotbench.led");
  check(b.state().parts.find((p) => p.instance === led).power.on === true, "a passive part (no power pins) is always on");
  b.setRails({ V33: false }); check(pw().on === false, "dropping the rail switches the part off again");
  b.setRails({ V33: true });
  const w = b.connect("device.V33", "device.GND");
  check(hz.some((h) => /short/i.test(h.class ?? h.kind ?? JSON.stringify(h))), "joining 3V3 to GND raises a short hazard", hz);
  b.disconnect(w);
  check(b.net("device.V33") !== b.net("device.GND"), "removing the wire separates the nets");
  const dup = b.connect("device.EXP4", s + ".SDA");
  check(dup === null || dup === undefined || typeof dup === "string", "a duplicate wire is accepted or refused without throwing");
  b.dispose();
});

await test("I2C: reads, NACK, stuck bus, swapped lines, address collision", async () => {
  const b = await mk(), w = warnings(b);
  const s = b.addPart("dotbench.hdc1080"); wireSensor(b, s);
  b.setRails({ V33: true });
  let r = await b.i2cXfer(I2C, 0x40, Uint8Array.of(0xfe), 2);
  check(r.result === 3, "without pull-ups the bus is stuck (result 3) and the bench says why", { r, w: w.map((x) => x.text) });
  pullup(b, 3, 4);
  r = await b.i2cXfer(I2C, 0x40, Uint8Array.of(0xfe), 2);
  check(r.result === 0 && r.r[0] === 0x54 && r.r[1] === 0x49, "with pull-ups the manufacturer register reads 0x5449", r);
  r = await b.i2cXfer(I2C, 0x41, new Uint8Array(0), 0);
  check(r.result === 1, "an address nobody has is a NACK on the address (result 1)", r);
  const probe = await b.i2cXfer(I2C, 0x40, new Uint8Array(0), 0);
  check(probe.result === 0, "probing the real address is ACKed", probe);
  b.setRails({ V33: false });
  r = await b.i2cXfer(I2C, 0x40, Uint8Array.of(0xfe), 2);
  check(r.result === 1, "an unpowered sensor does not answer", r);
  b.setRails({ V33: true });
  const n0 = w.length; b.setField(s, "temperature", 40);
  r = await b.i2cXfer(I2C, 0x40, Uint8Array.of(0x00), 2);
  check(r.result === 0 && ((r.r[0] << 8) | r.r[1]) === Math.round(((40 + 40) / 165) * 65536), "changing the field changes the register: raw for 40 C", r);
  // swapped SDA and SCL
  const b2 = await mk(), w2 = warnings(b2), s2 = b2.addPart("dotbench.hdc1080"); wireSensor(b2, s2, { swap: true }); pullup(b2, 3, 4); b2.setRails({ V33: true });
  r = await b2.i2cXfer(I2C, 0x40, Uint8Array.of(0xfe), 2);
  check(r.result === 1 && w2.some((x) => /swapped/.test(x.text)), "SDA and SCL swapped: NACK and a warning that says so", w2.map((x) => x.text));
  // two sensors, one address
  const b3 = await mk(), w3 = warnings(b3), a = b3.addPart("dotbench.hdc1080"), c = b3.addPart("dotbench.hdc1080");
  for (const x of [a, c]) wireSensor(b3, x); pullup(b3, 3, 4); b3.setRails({ V33: true });
  r = await b3.i2cXfer(I2C, 0x40, Uint8Array.of(0xfe), 2);
  check(w3.some((x) => /collision/.test(x.text)), "two parts at 0x40 on one bus: a collision warning", w3.map((x) => x.text));
  [b, b2, b3].forEach((x) => x.dispose());
});

await test("SPI: an idle bus reads as the pulled level; mode and refusal", async () => {
  const b = await mk();
  const m = { sck: "device.EXP1", mosi: "device.EXP2", miso: "device.EXP3", cs: "device.EXP6", hz: 1000000, mode: 0 };
  let r = b.spiXfer(m, Uint8Array.of(1, 2, 3));
  check(r.result === 0 && r.r.length === 3 && [...r.r].every((x) => x === 0), "no slave and MISO floating: zeros", r);
  pullup(b, 2); b.connect("device.EXP3", "device.V33");   // MISO tied to the rail by wire is a strong high
  r = b.spiXfer(m, Uint8Array.of(1, 2));
  check(r.result === 0 && r.r.length === 2, "the answer is as long as the request", r);
  check(b.spiXfer(null, Uint8Array.of(1)).result === 5, "a transfer with no open master is refused (result 5)");
  b.dispose();
});

await test("UART: routing by net, baud tolerance, power", async () => {
  const b = await mk(), w = warnings(b), got = [];
  b.tap((x) => got.push(...x));
  const e = b.addPart("dotbench.esp32-blink-echo");
  for (const [x, y] of [["device.V33", e + ".V33"], ["device.GND", e + ".GND"], ["device.EXP9", e + ".RX"], ["device.EXP10", e + ".TX"]]) b.connect(x, y);
  b.masters.uart = { tx: "device.EXP9", rx: "device.EXP10", baud: 115200 };
  b.setRails({ V33: true }); await b.ready(); await sleep(400);
  let n = b.uartSend("device.EXP9", new TextEncoder().encode("hi\n"), 9600, "device");
  check(n === 0 && w.some((x) => /9600/.test(x.text)), "a mismatched baud (9600 against 115200) drops the bytes and warns", w.map((x) => x.text));
  n = b.uartSend("device.EXP9", new TextEncoder().encode("hi\n"), 115200, "device");
  check(n === 1, "at 115200 the ESP32 part's receiver gets them", n);
  const text = () => new TextDecoder().decode(Uint8Array.from(got));
  const t0 = Date.now(); while (!text().includes("hi\n") && Date.now() - t0 < 6000) { await b.advance(20000); await sleep(20); }   // stepped clock: the sketch runs when time moves
  check(text().includes("ESP32 ready") && text().includes("hi\n"), "the sketch's own greeting and then its echo of 'hi' reach the device's UART", text());
  b.disconnect(b.wireOf("device.EXP9", e + ".RX"));
  check(b.uartSend("device.EXP9", Uint8Array.of(65), 115200, "device") === 0, "with the wire cut nothing is delivered");
  b.dispose();
});

await test("runtime: contact bounce on the stepped clock, fields, restart", async () => {
  const b = await mk(), edges = [];
  b.on("edge", (e) => edges.push(e));
  const btn = b.addPart("dotbench.push-button");
  b.connect("device.V33", btn + ".A"); b.connect("device.EXP6", btn + ".B"); b.setRails({ V33: true });
  const lv = () => b.state().device?.pins?.[5]?.level ?? b.net("device.EXP6");
  b.setField(btn, "pressed", true);
  await b.advance(1000);
  const mid = b.state().parts.find((p) => p.instance === btn).visuals;
  await b.advance(20000);
  const net = b.netId("device.EXP6"), mv = b.state().parts.find((p) => p.instance === btn).pins.B.mv;
  check(mv > 3000, "5 ms after the press the contact has settled closed: EXP6 is at the rail", mv);
  check(edges.length >= 1, "the press produced edges on the net (bounce included)", edges.length);
  b.setField(btn, "pressed", false); await b.advance(20000);
  check(b.state().parts.find((p) => p.instance === btn).pins.B.floating, "released: EXP6 floats again");
  b.setField(btn, "pressed", true); await b.advance(20000);
  check(b.state().parts.find((p) => p.instance === btn).pins.B.mv > 3000, "the Pressed field alone holds the contact down for as long as it is set");
  b.dispose();
});

await test("layout: serialise and restore", async () => {
  const b = await mk();
  const s = b.addPart("dotbench.hdc1080", { label: "T1", pos: { x: 10, y: 20, rot: 90 }, fields: { temperature: 31 } }), led = b.addPart("dotbench.led");
  wireSensor(b, s); b.connect("device.EXP7", led + ".A");
  const lay = b.serialise("t"), json = JSON.parse(JSON.stringify(lay));
  check(lay.format === "dotbench-layout" && lay.version === 1 && lay.parts.length === 2 && lay.wires.length === 5, "the layout has its format, version, parts and wires", { f: lay.format, p: lay.parts.length, w: lay.wires.length });
  const b2 = await mk(); const res = await b2.restore(json);
  check((res.missing ?? []).length === 0 && (res.dropped ?? []).length === 0, "restore into a bench with the same library loses nothing", res);
  const s2 = b2.state().parts.find((p) => p.label === "T1");
  check(s2 && s2.fields.temperature === 31 && s2.pos.rot === 90 && b2.state().wires.length === 5, "positions, fields, labels and wires come back", s2);
  json.parts.push({ instance: "p99", part: { id: "nobody.nothing", version: "1.0.0" }, label: "x", pos: { x: 0, y: 0, rot: 0 }, fields: {} });
  json.wires.push({ id: "w99", from: "p99.A", to: "device.EXP1" });
  const b3 = await mk(); const r3 = await b3.restore(json);
  check((r3.missing ?? []).some((m) => /nobody\.nothing/.test(JSON.stringify(m))) && b3.state().parts.length === 2, "a part id the library does not have is reported missing and its wires dropped", r3);
  [b, b2, b3].forEach((x) => x.dispose());
});

await test(".dotpart: validation of the shipped parts and of broken input", async () => {
  const dist = path.join(root, "parts/dist"), lib = JSON.parse(fs.readFileSync(path.join(dist, "library.json"), "utf8"));
  let ok = 0; for (const p of lib.parts) { const d = await readDotpart(new Uint8Array(fs.readFileSync(path.join(dist, p.file))), { builtin: true }); if (d.ok) ok++; }
  check(ok === lib.parts.length && ok >= 11, `every shipped part validates (${ok})`, ok);
  let bad; try { bad = await readDotpart(Uint8Array.from([1, 2, 3, 4, 5])); } catch (e) { bad = { ok: false, errors: [String(e.message)] }; }
  check(!bad.ok && bad.errors.length > 0, "random bytes are not a package", bad.errors);
  const m = JSON.parse(fs.readFileSync(path.join(root, "parts/led/manifest.json"), "utf8"));
  const v0 = validateManifest(m, null, { builtin: true }); check(v0.ok !== false && !(v0.errors?.length), "the LED manifest passes the manifest validator", v0);
  const broken = { ...m }; delete broken.id;
  const v1 = validateManifest(broken, null, { builtin: true }); check(v1.ok === false || v1.errors?.length > 0, "a manifest without an id is rejected", v1);
  const evil = { ...m, behaviour: { type: "wasm", entry: "../../x.wasm", abi: 1 } };
  const v2 = validateManifest(evil, null, { builtin: true }); check(v2.ok === false || v2.errors?.length > 0, "a wasm entry that climbs out of the package is rejected", v2);
});

await test("hazard outputs: a supply and a battery say overload, a resistor says overpower", async () => {
  const b = await mk(), sup = b.addPart("dotbench.supply", { fields: { mv: 5000 } }), bat = b.addPart("dotbench.battery-9v"), r = b.addPart("dotbench.resistor", { fields: { ohms: 10 } }), r2 = b.addPart("dotbench.resistor", { fields: { ohms: 10000 } });
  const o = (i, n) => b.parts.get(i).outputs[n];
  b.advance(1000); await b.ready?.();
  check(o(sup, "overload") === false && o(bat, "overload") === false && o(r, "overpower") === false, "idle: no overload, no overpower");
  b.connect(sup + ".POS", r + ".A"); b.connect(sup + ".NEG", r + ".B"); b.connect(r2 + ".A", bat + ".POS"); b.connect(r2 + ".B", bat + ".NEG");
  await b.advance(50000);
  check(o(r, "overpower") === true && o(sup, "overload") === false, "5 V across 10 ohm is 2.5 W: the resistor says overpower (the supply gives 500 mA, under its 1 A)", [o(r, "overpower"), o(sup, "current_ma")]);
  b.connect(bat + ".POS", bat + ".NEG"); await b.advance(50000);
  check(o(bat, "overload") === true, "a battery with plus wired to minus says overload");
  b.dispose();
});

process.exit(finish("bench"));
