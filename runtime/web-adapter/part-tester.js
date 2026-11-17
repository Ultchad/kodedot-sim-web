// SPDX-License-Identifier: GPL-3.0-or-later
// PartTester: play "the device" in front of ONE part, headless and in stepped virtual time. Used by `dotbench part test` and the Node tests.
// The part's signal pins are wired to device EXP1.. in manifest order, power pins to V33 or V5 (whichever their range includes), grounds to GND.
import { Bench } from "./bench.js";
import { BenchClock } from "./bench-clock.js";

export class PartTester {
  /** @param {object} def a part definition (readDotpart result, or any object with manifest, wasm, sha256, bytes) */
  static async create(def, o = {}) {
    const t = new PartTester(def, o);
    await t.init(o);
    return t;
  }
  constructor(def, o = {}) {
    this.def = def; this.m = def.manifest;
    this.bench = new Bench({ clock: new BenchClock({ mode: "stepped" }), wasm: o.wasm });
    this.uartOut = [];
    this.bench.tap((b) => this.uartOut.push(...b));
  }
  async init(o = {}) {
    const b = this.bench, m = this.m;
    b.registerPart(this.def);
    this.instance = b.addPart(m.id, { fields: o.fields });
    this.exp = new Map(); let n = 0;
    for (const pin of m.pins) {
      if (pin.kind === "io" || pin.kind === "analog") { if (n < 14) { this.exp.set(pin.name, n); b.connect(`device.EXP${n + 1}`, `${this.instance}.${pin.name}`); n++; } }
      else if (pin.kind === "ground") b.connect("device.GND", `${this.instance}.${pin.name}`);
      else if (pin.kind === "power_in") {
        const v5 = (pin.min_mv ?? 0) <= 5000 && (pin.max_mv ?? 0) >= 5000 && !((pin.min_mv ?? 0) <= 3300 && (pin.max_mv ?? 0) >= 3300);
        b.connect(v5 ? "device.V5" : "device.V33", `${this.instance}.${pin.name}`);
      }
    }
    for (const nm of ["SDA", "SCL"]) if (this.exp.has(nm)) b.setDevicePin(this.exp.get(nm), { mode: "in", pull: "up" });
    b.setRails({ V33: true, V5: true });
    this.uartBaud(115200);
    await b.ready();
  }
  get part() { return this.bench.parts.get(this.instance); }
  term(name) { return `${this.instance}.${name}`; }
  dev(name) { if (!this.exp.has(name)) throw new Error(`pin ${name} has no header position (io and analog pins only)`); return `device.EXP${this.exp.get(name) + 1}`; }
  async advance(ms) { await this.bench.advance(ms * 1000); }
  setField(name, v) { return this.bench.setField(this.instance, name, v); }
  press(field, ms) { return this.bench.press(this.instance, field, ms); }
  output(name) { return this.part.outputs[name]; }
  console() { const p = this.part; return p.console.join("\n") + (p.consoleTail ? (p.console.length ? "\n" : "") + p.consoleTail : ""); }
  serialIn(text) { this.bench.serialIn(this.instance, text); }
  /** The tester drives a header pin: level 0/1, or null to release it. */
  drive(name, level) { const i = this.exp.get(name); this.bench.setDevicePin(i, level === null ? { mode: "z" } : { mode: "out", level: level ? 1 : 0 }); }
  level(name) { return this.bench.net(this.dev(name)).level; }
  mv(name) { const n = this.bench.net(this.dev(name)); return n.floating ? 0 : n.mv; }
  pullup(name) { this.bench.setDevicePin(this.exp.get(name), { mode: "in", pull: "up" }); }
  /** I2C transaction as the device would do it: write w, then read rlen (a repeated start). {ok, nack, data, result} */
  async i2c(addr, w = [], rlen = 0, hz = 100000) {
    const r = await this.bench.i2cXfer({ sda: this.dev("SDA"), scl: this.dev("SCL"), hz }, addr, Uint8Array.from(w), rlen);
    return { ok: r.result === 0, result: r.result, data: r.r ? Array.from(r.r) : [] };
  }
  async spi(w, { mode = 0, hz = 1000000 } = {}) {
    const r = await this.bench.spiXfer({ sck: this.dev("SCK"), mosi: this.dev("MOSI"), miso: this.dev("MISO"), cs: this.exp.has("CS") ? this.dev("CS") : this.dev("SCK"), hz, mode }, Uint8Array.from(w));
    return Array.from(r.r ?? []);
  }
  /** UART: the tester's TX is wired to the part's RX pin and the tester's RX to the part's TX pin (parts with pins named RX and TX). */
  uartBaud(baud) { if (this.exp.has("RX") && this.exp.has("TX")) this.bench.masters.uart = { tx: this.dev("RX"), rx: this.dev("TX"), baud }; }
  uartSend(text, { baud = 115200 } = {}) {
    const bytes = typeof text === "string" ? new TextEncoder().encode(text) : Uint8Array.from(text);
    this.uartBaud(baud);
    this.bench.uartSend(this.dev("RX"), bytes, baud, "device");
  }
  uartTake() { const s = new TextDecoder().decode(Uint8Array.from(this.uartOut)); this.uartOut.length = 0; return s; }
  state() { return this.bench.state(); }
  dispose() { this.bench.dispose(); }
}

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/**
 * Run one scenario file (tests/*.test.json). Steps: advance_ms, set_field, press {field, ms}, expect_serial, serial_in, i2c {addr, write, read, expect, expect_nack},
 * spi {write, expect}, set_pin {pin, level|null}, expect_pin {pin, level | mv_min/mv_max}, uart_send {text}, uart_listen {}, expect_uart {contains}, expect_output {name, value}.
 * @returns {Promise<string[]>} one line per step; throws Error on the first failure.
 */
export async function runScenario(tester, t, log = []) {
  let n = 0;
  const fail = (m) => { throw new Error(`${t.name ?? "scenario"}, step ${n}: ${m}`); };
  for (const s of t.steps) {
    n++;
    if (s.advance_ms !== undefined) await tester.advance(s.advance_ms);
    else if (s.set_field) for (const [k, v] of Object.entries(s.set_field)) tester.setField(k, v);
    else if (s.press) { const p = tester.press(s.press.field, s.press.ms ?? 150); await tester.advance((s.press.ms ?? 150) + 5); await p; }
    else if (s.serial_in !== undefined) { tester.serialIn(s.serial_in); await tester.advance(5); }
    else if (s.expect_serial !== undefined) { await tester.advance(1); const c = tester.console(); if (!c.includes(s.expect_serial)) fail(`serial lacks ${JSON.stringify(s.expect_serial)}; got ${JSON.stringify(c.slice(-200))}`); }
    else if (s.i2c) {
      const r = await tester.i2c(s.i2c.addr, s.i2c.write ?? [], s.i2c.read ?? 0, s.i2c.hz);
      if (s.i2c.expect_nack) { if (r.ok) fail("expected a NACK, the part answered"); }
      else { if (!r.ok) fail(`expected an ACK, got result ${r.result}`); if (s.i2c.expect && !eq(r.data, s.i2c.expect)) fail(`read ${JSON.stringify(r.data)}, expected ${JSON.stringify(s.i2c.expect)}`); }
    } else if (s.spi) { const r = await tester.spi(s.spi.write, s.spi); if (s.spi.expect && !eq(r, s.spi.expect)) fail(`SPI read ${JSON.stringify(r)}, expected ${JSON.stringify(s.spi.expect)}`); }
    else if (s.set_pin) tester.drive(s.set_pin.pin, s.set_pin.level ?? null);
    else if (s.expect_pin) {
      const e = s.expect_pin;
      if (e.level !== undefined && tester.level(e.pin) !== e.level) fail(`pin ${e.pin} level is ${tester.level(e.pin)} (${Math.round(tester.mv(e.pin))} mV), expected ${e.level}`);
      if (e.mv_min !== undefined && tester.mv(e.pin) < e.mv_min) fail(`pin ${e.pin} is ${Math.round(tester.mv(e.pin))} mV, expected at least ${e.mv_min}`);
      if (e.mv_max !== undefined && tester.mv(e.pin) > e.mv_max) fail(`pin ${e.pin} is ${Math.round(tester.mv(e.pin))} mV, expected at most ${e.mv_max}`);
    } else if (s.uart_listen) tester.uartBaud(s.uart_listen.baud ?? 115200);
    else if (s.uart_send) { tester.uartSend(s.uart_send.text, s.uart_send); await tester.advance(5); }
    else if (s.expect_uart) { await tester.advance(5); const u = tester.uartTake(); if (!u.includes(s.expect_uart.contains)) fail(`UART lacks ${JSON.stringify(s.expect_uart.contains)}; got ${JSON.stringify(u)}`); }
    else if (s.expect_output) { const v = tester.output(s.expect_output.name); if (v !== s.expect_output.value) fail(`output ${s.expect_output.name} is ${v}, expected ${s.expect_output.value}`); }
    else fail("unknown step " + JSON.stringify(s));
    log.push(`ok step ${n}: ${s.comment ?? JSON.stringify(s).slice(0, 90)}`);
  }
  return log;
}
