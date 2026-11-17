// Shared helpers of the BLE tests: boot an app (or any .dotbench) with the radio and BLE glue attached the way the browser adapter does.
import fs from "node:fs";
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

/** Boot `pkg` (an app name under build/apps, or an absolute .dotbench path) with radio + BLE glue. opts: harness boot options plus { radio:false }. */
export async function bootBle(pkg, opts = {}) {
  const file = pkg.endsWith(".dotbench") ? pkg : pkgPath(pkg);
  const a = await boot(file, opts);
  const M = a.M, ticks = [], events = [];
  const ctx = {
    module: M, statePtr: a.statePtr, u32: a.u32, i32: a.i32, setU32: a.setU32,
    call: (name, ...args) => M["_" + name](...args),
    alloc: (n) => M._malloc(n), free: (p) => M._free(p), heap: () => M.HEAPU8,
    emit: (type, data) => events.push({ type, ...data }),
    onTick: (cb) => ticks.push(cb),
  };
  let radio = null;
  if (fs.existsSync(a.dir + "/glue/radio/radio.js") && opts.radio !== false) {
    radio = (await import(pathToFileURL(a.dir + "/glue/radio/radio.js").href)).default(ctx);
    radio.fastTiming?.();
  }
  const mod = await import(pathToFileURL(a.dir + "/glue/ble/ble.js").href);
  const ble = mod.default(ctx);
  const timer = setInterval(() => ticks.forEach((cb) => cb()), 20);
  const shutdown = a.shutdown;
  a.shutdown = () => { clearInterval(timer); ble.dispose(); radio?.dispose?.(); shutdown(); };
  a.ble = ble; a.radio = radio; a.events = events; a.glue = mod; a.ctx = ctx;
  a.stubLines = () => (a.logText() + "\n" + (a.logs ?? []).join("\n")).split("\n").filter((l) => /not implemented/.test(l));
  a.press = async (id, ms = 80) => { a.button(id, true); await sleep(ms); a.button(id, false); };
  a.waitEvent = async (pred, ms = 5000, from = 0) => {
    const t0 = Date.now();
    for (;;) {
      const hit = events.slice(from).find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > ms) throw new Error("timeout waiting for a BLE event; have " + JSON.stringify(events.slice(from, from + 10)).slice(0, 600));
      await sleep(20);
    }
  };
  return a;
}
