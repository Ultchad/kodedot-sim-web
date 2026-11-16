// Shared helpers of the RFID tests: boot an app, attach the real glue (runtime/drivers/rfid/rfid.js as packaged
// in the .dotbench) to the booted module the way the browser adapter does, and drive the app's console.
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

/** Boot `pkg` (app name under build/apps) with the RFID glue attached. */
export async function bootRfid(pkg) {
  const a = await boot(pkgPath(pkg));
  const M = a.M, ticks = [], events = [];
  const ctx = {
    module: M, statePtr: a.statePtr, u32: a.u32, i32: a.i32, setU32: a.setU32,
    call: (name, ...args) => M["_" + name](...args),
    alloc: (n) => M._malloc(n), free: (p) => M._free(p), heap: () => M.HEAPU8,
    emit: (type, data) => events.push({ type, ...data }),
    onTick: (cb) => ticks.push(cb),
  };
  const glueUrl = pathToFileURL(a.dir + "/glue/rfid/rfid.js").href;
  const mod = await import(glueUrl);
  const rfid = mod.default(ctx);
  const timer = setInterval(() => ticks.forEach((cb) => cb()), 20);
  const shutdown = a.shutdown;
  a.shutdown = () => { clearInterval(timer); shutdown(); };
  a.rfid = rfid; a.events = events; a.glue = mod;

  // ---- console ----
  let lineNo = 0;
  a.type = (line) => {
    const b = Buffer.from(line + "\n"), p = M._malloc(b.length + 1);
    M.HEAPU8.set(b, p);
    M._kweb_console_input(p, b.length);
    M._free(p);
  };
  /** All RES lines the app has logged so far. */
  a.res = () => a.logText().split("\n").map((l) => l.trim()).filter((l) => l.includes("RES "));
  /** Type a command and wait for the RES line that answers it (matching `re`); returns the text after "RES ". */
  a.cmd = async (line, re, ms = 8000) => {
    const before = a.res().length;
    a.type(line);
    const t0 = Date.now();
    for (;;) {
      const lines = a.res().slice(before);
      const hit = lines.find((l) => re.test(l.slice(l.indexOf("RES ") + 4)));
      if (hit) { a.rfid.poll(); return hit.slice(hit.indexOf("RES ") + 4); }
      if (Date.now() - t0 > ms) throw new Error(`no RES line matching ${re} after '${line}' in ${ms} ms; got ${JSON.stringify(lines)}\n${a.logText().slice(-1500)}`);
      await sleep(25);
    }
  };
  /** Call an app console function: fn("read", 2000) / fn("write", "01:02:03:04:05;3000") / fn("emustop"); waits for the RES line. */
  a.fn = (name, arg, ms) => {
    const line = "function name=\"" + name + "\"" + (arg === undefined ? "" : " arg=" + (typeof arg === "string" ? JSON.stringify(arg) : arg));
    return a.cmd(line, new RegExp("^(" + name + "|busy)\\b"), ms);
  };
  /** Wait for a glue event (from a.events) after index `from`. */
  a.waitEvent = async (pred, ms = 5000, from = 0) => {
    const t0 = Date.now();
    for (;;) {
      const hit = events.slice(from).find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > ms) throw new Error("timeout waiting for an RFID event; have " + JSON.stringify(events.slice(from)));
      await sleep(20);
    }
  };
  await a.waitFor(() => a.logText().includes("rfid_api up") || pkg !== "rfid_api", 20000, "app boot");
  return a;
}
