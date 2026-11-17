// Every lock a page-facing export takes, held by a firmware thread while the page's thread calls the export (docs/STATUS-panic.md).
// The rule: the page's thread never waits for a lock. Two ways a firmware thread holds one, both deterministic (no timing):
//   A. orphaned: a thread takes the lock and exits, as a worker the host terminated leaves it. The page calls every export of that lock.
//   B. across a pthread_create: a worker takes the lock and creates a thread. A worker's pthread_create is proxied to the page's main
//      thread and waits for its event loop; the page (here: Atomics.wait until the worker is inside, then synchronous calls with the
//      event loop NOT running) must get "busy" back and return to its event loop, which lets the worker finish and release the lock.
// Before the fix the first call into a held lock never returned (the child is killed after 120 s and the test fails).
import { spawnSync } from "node:child_process";
import { Bench, RESET, sleep, pkgPath } from "../persist/host.mjs";

if (process.argv[2] !== "--child") {
  const r = spawnSync(process.execPath, ["--expose-gc", new URL(import.meta.url).pathname, "--child"], { encoding: "utf8", timeout: 120000 });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.log("FAIL - the page thread hung or failed on a held lock (exit " + r.status + ", signal " + r.signal + ")\n" + (r.stderr ?? "").slice(-800)); process.exit(1); }
  process.exit(0);
}
const bench = await new Bench({ memory: true }).open();
const a = await bench.boot(pkgPath("kodeos"), { reason: RESET.POWERON });
await a.waitFor(() => a.logText().includes("kaos.radio"), 90000, "kodeOS up");
await sleep(1500);
const M = a.M, p = M._malloc(4096), s = p + 2048;
M.HEAPU8.fill(0, p, p + 4096); M.HEAPU8.set([120, 0], s);          // "x"
let bad = 0;
const check = (ok, name, d = "") => { if (!ok) bad++; console.log((ok ? "ok   - " : "FAIL - ") + name + (d !== "" ? "  " + d : "")); };

// the exports of each registered lock, with arguments that are safe to repeat
const calls = {
  rfid: [["rfid_poll", () => M._rfid_poll()], ["rfid_obj_is_near", () => M._rfid_obj_is_near(0)], ["rfid_fault_set", () => M._rfid_fault_set(0)], ["rfid_state", () => M._rfid_state(p, p + 256)]],
  haptic: [["haptic_poll", () => M._haptic_poll()], ["haptic_get", () => M._haptic_get(0)], ["haptic_event_pop", () => M._haptic_event_pop(p)]],
  power: [["power_get", () => M._power_get(0)], ["power_set_load", () => M._power_set_load(0)], ["power_event_pop", () => M._power_event_pop(p)]],
  motion: [["motion_get", () => M._motion_get(0)]],
  usb: [["usb_get", () => M._usb_get(0)], ["usb_recv", () => M._usb_recv(p, 16)], ["usb_host", () => M._usb_host(0)]],
  audio: [["audio_cap_stop", () => M._audio_cap_stop()]],
  nvs: [["dbnvs_list", () => M._dbnvs_list(p, 256)], ["dbnvs_type", () => M._dbnvs_type(s, s)], ["dbnvs_usage", () => M._dbnvs_usage(p, p + 4)]],
  console: [["kweb_console_input", () => M._kweb_console_input(p, 0)]],
  ir: [["ir_get", () => M._ir_get(0)], ["ir_stats", () => M._ir_stats(p)]],
  "text-ring": [["kweb_text_drain", () => M._kweb_text_drain(p, 256)]],
};
const n = M._dbpage_lock_count();
const names = Array.from({ length: n }, (_, i) => M.UTF8ToString(M._dbpage_lock_name(i)));
check(n >= 10 && Object.keys(calls).every((k) => names.includes(k)), "every page-facing lock is registered", names.join(","));
check(names.every((k) => calls[k]), "and every registered lock has its exports in this test", names.filter((k) => !calls[k]).join(",") || "none missing");

/** Calls each export of lock `name` once; returns [{fn, ms, busy}]. */
const callAll = (name) => (calls[name] ?? []).map(([fn, f]) => { M._dbpage_busy_take(); const t = performance.now(); f(); const ms = performance.now() - t; return { fn, ms, busy: M._dbpage_busy_take() > 0 }; });

// B: held across a pthread_create that needs this very thread's event loop
for (let i = 0; i < n; i++) {
  const name = names[i], st = M._dbpage_test_state_ptr(i) >> 2;
  M._dbpage_test_hold_create(i);
  const w = Atomics.wait(M.HEAP32, st, 0, 20000);                    // blocks without spinning; the event loop does not run meanwhile
  const during = callAll(name);
  check(w !== "timed-out" && during.every((c) => c.busy && c.ms < 200), `B ${name}: held across a pthread_create, every export answers busy at once`, JSON.stringify(during.map((c) => [c.fn, Math.round(c.ms)])));
  await sleep(500);                                                  // the event loop runs: the worker's create completes, the lock is released
  check(Atomics.load(M.HEAP32, st) === 2, `B ${name}: the worker finished once the page returned to its event loop`);
  const after = callAll(name);
  check(after.every((c) => !c.busy), `B ${name}: and the exports work again`, JSON.stringify(after.map((c) => [c.fn, c.busy])));
}
// C: the input pump. A firmware task is the first to start it (kweb_set_touch_hook at boot): its pthread_create waits for the page's event
// loop. The page's kweb_touch must not wait for that (it used to sit in a pthread_once the worker held: the settings-check hang after a boot).
{
  const st = M._dbpage_test_pump_state_ptr() >> 2;
  M._dbpage_test_pump_via_worker();
  const w = Atomics.wait(M.HEAP32, st, 0, 20000);                    // state 1: the worker is creating the pump
  M._dbpage_busy_take();
  const t = performance.now(); M._kweb_touch(0, 0, 0); const ms = performance.now() - t;
  check(w !== "timed-out" && ms < 200 && Atomics.load(M.HEAP32, st) === 1, "C kweb_touch while a worker is creating the input pump returns at once", Math.round(ms) + " ms");
  await sleep(500);
  check(Atomics.load(M.HEAP32, st) === 2, "C and the worker finished once the page returned to its event loop");
}
// A: orphaned
for (let i = 0; i < n; i++) M._dbpage_test_orphan(i);
await sleep(500);
for (let i = 0; i < n; i++) {
  const during = callAll(names[i]);
  check(during.every((c) => c.busy && c.ms < 200), `A ${names[i]}: orphaned, every export answers busy within the bound`, JSON.stringify(during.map((c) => [c.fn, Math.round(c.ms)])));
}
process.exit(bad ? 1 : 0);
