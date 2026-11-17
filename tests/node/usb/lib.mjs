// Shared helpers for this area's tests (duplicated per area on purpose: tests stay independent).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.join(here, "../../..");

export function makeCheck() {
  const st = { failed: 0, passed: 0 };
  const check = async (name, fn) => {
    try { await fn(); st.passed++; console.log("ok   - " + name); }
    catch (e) { st.failed++; console.log("FAIL - " + name + "\n" + e.stack); }
  };
  return { check, st };
}
export function finish(label, st) {
  console.log(`${label}: ${st.failed ? "FAILED" : "PASSED"} (${st.passed} ok, ${st.failed} failed)`);
  process.exit(st.failed ? 1 : 0);
}
/** A glue ctx over a booted app, shaped like the page's (call, alloc, heap, emit, onTick). */
export async function loadGlue0(a, area) {
  const M = a.M, emitted = [], ticks = [];
  const ctx = {
    module: M, statePtr: a.statePtr, u32: a.u32, i32: a.i32, setU32: a.setU32,
    call: (fn, ...args) => M["_" + fn](...args),
    alloc: (n) => M._malloc(n), free: (p) => M._free(p),
    heap: () => M.HEAPU8,
    emit: (type, data) => emitted.push({ type, data }),
    onTick: (cb) => ticks.push(cb),
  };
  const mod = await import(pathToFileURL(path.join(repo, "runtime/drivers", area, area + ".js")).href);
  const api = mod.default(ctx);
  return { api, emitted, tick: () => ticks.forEach((t) => t()), ctx };
}
/** Register-level access through the area's test hooks. */
export function bus(a, area) {
  const M = a.M, p = M._malloc(4096);
  const rd = (addr, reg, n = 1) => {
    const rc = M["_" + area + "_i2c_read"](addr, reg, p, n);
    if (rc !== 0) throw new Error(`NACK reading ${addr.toString(16)}:${reg.toString(16)}`);
    return Array.from(M.HEAPU8.slice(p, p + n));
  };
  const wr = (addr, reg, bytes) => {
    M.HEAPU8.set(bytes, p);
    return M["_" + area + "_i2c_write"](addr, reg, p, bytes.length);
  };
  return { rd, wr, r8: (addr, reg) => rd(addr, reg, 1)[0] };
}
/** Like the page: both glue objects of an app (usb + power) on one booted module, ticked every 20 ms. */
export async function loadGlues(a, areas) {
  const out = {}, ticks = [];
  for (const area of areas) {
    const g = await loadGlue0(a, area);
    out[area] = g; ticks.push(g.tick);
  }
  const timer = setInterval(() => ticks.forEach((t) => t()), 20);
  return { ...out, stop: () => clearInterval(timer) };
}
