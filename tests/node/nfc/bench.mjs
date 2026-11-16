// Shared helper for the NFC tests: boots an app and attaches the area's REAL JS glue (runtime/drivers/nfc/nfc.js)
// to the Node instance, with a context shaped like the browser adapter's (same calls, same events).
import assert from "node:assert/strict";
import glue from "../../../runtime/drivers/nfc/nfc.js";
import { boot, pkgPath, sleep } from "../harness.mjs";

export { pkgPath, sleep, assert };
export const BTN = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, TOP: 4, BOT: 5 };

/** Boot `app` (a name under $DOTBENCH_BUILD/apps) and attach the glue. Adds: a.nfc, a.events, a.poll(), a.press(btn). */
export async function bootNfc(app, opts = {}) {
  const a = await boot(pkgPath(app), opts);
  const events = [];
  let tick = null;
  const ctx = {
    module: a.M, statePtr: a.statePtr,
    call: (fn, ...args) => a.M["_" + fn](...args),
    alloc: (n) => a.M._malloc(n), free: (p) => a.M._free(p), heap: () => a.M.HEAPU8,
    emit: (type, data) => events.push({ type, ...data }),
    onTick: (cb) => { tick = cb; },
  };
  a.nfc = glue(ctx);
  a.events = events;
  a.poll = () => tick();
  a.press = async (btn, ms = 120) => { a.button(btn, true); await sleep(ms); a.button(btn, false); await sleep(150); };
  return a;
}

/**
 * bootNfc + wait for `ready` (a string in the log). Booting a second wasm instance in one Node process on a heavily
 * loaded machine sometimes stalls in early boot (after "kqp QF up", also with no NFC state at all, so not the area's
 * doing); such an attempt is shut down and repeated, up to 4 times.
 */
export async function bootReady(app, ready, opts = {}, ms = 45000) {
  let last;
  for (let i = 0; i < 4; i++) {
    const a = await bootNfc(app, opts);
    try { await until(a, () => a.logText().includes(ready), ms, app + " booting"); return a; } catch (e) { last = e; a.shutdown(); }
  }
  throw last;
}

/** Wait until pred() (polling the glue so events flow). */
export async function until(a, pred, ms, what) {
  const t0 = Date.now();
  for (;;) {
    a.poll(); a.drain();
    if (pred()) return;
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what + "\n--- log ---\n" + a.logText().split("\n").slice(-40).join("\n"));
    await sleep(25);
  }
}

/** Plain test runner: one line per check, non-zero exit on failure. */
export function runner() {
  const r = { failed: false, n: 0 };
  r.check = async (name, fn) => {
    r.n++;
    try { await fn(); console.log("ok   - " + name); } catch (e) { r.failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); }
  };
  r.done = (label) => { console.log(label + (r.failed ? ": FAILED" : ": PASSED") + " (" + r.n + " checks)"); return r.failed ? 1 : 0; };
  return r;
}

/** The nfc_api app: post a command, wait for its "done", return the result lines of that command. */
export function apiDriver(a) {
  let seq = 0;
  return async function cmd(line, timeoutMs = 15000) {
    const n = ++seq;
    assert.equal(a.M.ccall("nfcapp_cmd", "number", ["string"], [n + " " + line]), 0, "mailbox full");
    await until(a, () => a.logText().includes(`[${n}] done`), timeoutMs, `command ${n}: ${line}`);
    const out = [];
    for (const l of a.logText().split("\n")) { const m = l.match(new RegExp(`\\[${n}\\] (.*)$`)); if (m && m[1] !== "done") out.push(m[1]); }
    return out.join("\n");
  };
}
