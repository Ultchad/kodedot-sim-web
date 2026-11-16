// Shared bench of the radio / wifi / net tests: boot an app, attach the three real glue files (as packaged in the .dotbench) to the
// booted module the way the browser adapter does, and give tests the console, the APIs and a log matcher.
import { pathToFileURL } from "node:url";
import { boot, pkgPath, sleep } from "../harness.mjs";

export { pkgPath, sleep };
let failures = 0;
export function check(cond, what, detail) {
  if (cond) console.log("ok   - " + what);
  else { failures++; console.log("FAIL - " + what + (detail !== undefined ? "  [" + (typeof detail === "string" ? detail : JSON.stringify(detail)) + "]" : "")); }
}
export const failed = () => failures;
export function done(a, name) {
  console.log(name + ": " + (failures ? `FAILED (${failures})` : "PASSED"));
  if (a) a.shutdown();
  process.exit(failures ? 1 : 0);
}

/** Boot `pkg` (an app under build/apps) with radio, wifi and net glue attached. opts.attach = false boots with no glue at all. */
export async function bootRadio(pkg, opts = {}) {
  const a = await boot(pkgPath(pkg), opts.boot);
  const M = a.M, ticks = [], events = [];
  const ctx = {
    module: M, statePtr: a.statePtr, u32: a.u32, i32: a.i32, setU32: a.setU32,
    call: (name, ...args) => M["_" + name](...args),
    alloc: (n) => M._malloc(n), free: (p) => M._free(p), heap: () => M.HEAPU8,
    emit: (type, data) => events.push({ type, ...data }),
    onTick: (cb) => ticks.push(cb),
  };
  a.events = events;
  if (opts.attach !== false) {
    const load = async (area, file) => import(pathToFileURL(`${a.dir}/glue/${area}/${file}.js`).href);
    // order is deliberately net, wifi, radio: the glue files must not depend on it
    a.glue = { net: await load("net", "net"), wifi: await load("wifi", "wifi"), radio: await load("radio", "radio") };
    a.net = a.glue.net.default(ctx);
    a.wifi = a.glue.wifi.default(ctx);
    a.radio = a.glue.radio.default(ctx);
    a.world = a.radio.world;
    a.radio.fastTiming();
    if (opts.timing) Object.assign(a.world.timing, opts.timing);
  }
  const timer = setInterval(() => ticks.forEach((cb) => cb()), 20);
  const shutdown = a.shutdown;
  a.shutdown = () => { clearInterval(timer); a.radio?.dispose(); shutdown(); };
  a.type = (line) => { const b = Buffer.from(line + "\n"), p = M._malloc(b.length + 1); M.HEAPU8.set(b, p); M._kweb_console_input(p, b.length); M._free(p); };
  a.log = () => a.logText();
  /** Wait until the log matches re (RegExp or string) after position `from` (a.mark()). */
  a.mark = () => a.logText().length;
  a.waitLog = async (re, ms = 15000, from = 0) => {
    const rx = re instanceof RegExp ? re : new RegExp(re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const t0 = Date.now();
    for (;;) {
      const t = a.logText().slice(from);
      const m = rx.exec(t);
      if (m) return m;
      if (Date.now() - t0 > ms) throw new Error(`no log line ${rx} in ${ms} ms\n--- log ---\n${a.logText().slice(-2500)}`);
      await sleep(25);
    }
  };
  a.waitEvent = async (pred, ms = 10000, from = 0) => {
    const t0 = Date.now();
    for (;;) { const e = events.slice(from).find(pred); if (e) return e; if (Date.now() - t0 > ms) throw new Error("no event; got " + JSON.stringify(events.slice(from, from + 20))); await sleep(25); }
  };
  /** Type a console command; resolve once its ">ok" / ">err" line is in: { ok, err, lines (the ">|" result lines), text }. */
  a.cmd = async (line, ms = 10000) => {
    const m = a.mark(); a.type(line);
    const t0 = Date.now();
    for (;;) {
      const t = a.logText().slice(m);
      const x = /^>(ok|err[^\n]*)$/m.exec(t);
      if (x) return { ok: x[1] === "ok", err: x[1] === "ok" ? null : x[1], lines: t.split("\n").filter((l) => l.startsWith(">|")).map((l) => l.slice(2)), text: t };
      if (Date.now() - t0 > ms) throw new Error(`no >ok/>err after '${line}'\n` + t);
      await sleep(25);
    }
  };
  /** Press a button and release it (UP 0 DOWN 1 LEFT 2 RIGHT 3 TOP 4 BOT 5). */
  a.press = async (id, ms = 80) => { a.button(id, true); await sleep(ms); a.button(id, false); await sleep(30); };
  return a;
}
