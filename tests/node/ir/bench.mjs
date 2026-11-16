// Shared helpers of the IR tests: boot an app, attach the real glue (runtime/drivers/ir/ir.js as packaged in the .dotbench) to the booted
// module the way the browser adapter does, and drive the app's console.
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

/** Boot `pkg` (app name under build/apps) with the IR glue attached. opts are the harness's boot options (persist, reason, bootCount). */
export async function bootIr(pkg, opts = {}) {
  const a = await boot(pkgPath(pkg), opts);
  const M = a.M, ticks = [], events = [];
  const ctx = {
    module: M, statePtr: a.statePtr, u32: a.u32, i32: a.i32, setU32: a.setU32,
    call: (name, ...args) => M["_" + name](...args),
    alloc: (n) => M._malloc(n), free: (p) => M._free(p), heap: () => M.HEAPU8,
    emit: (type, data) => events.push({ type, ...data }),
    onTick: (cb) => ticks.push(cb),
  };
  const mod = await import(pathToFileURL(a.dir + "/glue/ir/ir.js").href);
  const ir = mod.default(ctx);
  const timer = setInterval(() => ticks.forEach((cb) => cb()), 20);
  const shutdown = a.shutdown;
  a.shutdown = () => { clearInterval(timer); ir.dispose(); shutdown(); };
  a.ir = ir; a.events = events; a.glue = mod; a.call = ctx.call;

  // ---- console ----
  a.type = (line) => {
    const b = Buffer.from(line + "\n"), p = M._malloc(b.length + 1);
    M.HEAPU8.set(b, p);
    M._kweb_console_input(p, b.length);
    M._free(p);
  };
  a.res = () => a.logText().split("\n").map((l) => l.trim()).filter((l) => l.includes("RES "));
  /** Type a command and wait for the RES line that answers it (matching `re`); returns the text after "RES ". */
  a.cmd = async (line, re, ms = 8000) => {
    const before = a.res().length;
    a.type(line);
    const t0 = Date.now();
    for (;;) {
      const lines = a.res().slice(before);
      const hit = lines.find((l) => re.test(l.slice(l.indexOf("RES ") + 4)));
      if (hit) { ir.poll(); return hit.slice(hit.indexOf("RES ") + 4); }
      if (Date.now() - t0 > ms) throw new Error(`no RES line matching ${re} after '${line}' in ${ms} ms; got ${JSON.stringify(lines)}\n${a.logText().slice(-1500)}`);
      await sleep(25);
    }
  };
  /** Call an app console function and wait for the RES line named like it (or "busy"). */
  a.fn = (name, arg, ms) => {
    const line = "function name=\"" + name + "\"" + (arg === undefined ? "" : " arg=" + (typeof arg === "string" ? JSON.stringify(arg) : arg));
    return a.cmd(line, new RegExp("^(" + name + "|busy)\\b"), ms);
  };
  /** Start a console function without waiting (for a window the test fills in itself). Resolves with the RES text. */
  a.fnAsync = (name, arg, ms) => a.fn(name, arg, ms);
  /** Wait until the app's receiver is armed, i.e. AO_Ir is listening. */
  a.waitArmed = () => a.waitFor(() => ir.state().armed, 10000, "the Dot's receiver to be armed");
  a.waitEvent = async (pred, ms = 5000, from = 0) => {
    const t0 = Date.now();
    for (;;) {
      const hit = events.slice(from).find(pred);
      if (hit) return hit;
      if (Date.now() - t0 > ms) throw new Error("timeout waiting for an IR event; have " + JSON.stringify(events.slice(from)).slice(0, 800));
      await sleep(20);
    }
  };
  /** Anything the app logged that says a function of this area was a generated stub. */
  a.stubLines = () => (a.logText() + "\n" + a.logs.join("\n")).split("\n").filter((l) => /not implemented/.test(l));
  if (pkg === "ir_api") await a.waitFor(() => a.logText().includes("ir_api up"), 20000, "app boot");
  return a;
}
