// The page's side of the "never block" rule (runtime/web-adapter/page-call.js): a write that meets a held lock is queued and repeated in
// order from the event loop with its buffers copied; a read answers "nothing yet"; nothing spins; after stop nothing is called.
// Deterministic: a fake module whose exports are busy a set number of times, a hand-driven scheduler.
import { makeCaller, READ_EXPORT } from "../../../runtime/web-adapter/page-call.js";

let bad = 0;
const check = (ok, name, d = "") => { if (!ok) bad++; console.log((ok ? "ok   - " : "FAIL - ") + name + (d !== "" ? "  " + d : "")); };

function fake() {
  const heap = new Uint8Array(4096); let brk = 64; const log = []; let busyLeft = 0, busyFlag = 0, dead = false;
  const M = {
    HEAPU8: heap,
    _malloc: (n) => { const p = brk; brk += (n + 7) & ~7; return p; },
    _free: () => {},
    _dbpage_busy_take: () => { const b = busyFlag; busyFlag = 0; return b; },
    _usb_send: (p, n) => { if (busyLeft > 0) { busyLeft--; busyFlag = 1; return 0; } log.push(["send", Array.from(heap.slice(p, p + n))]); return n; },
    _power_set_load: (ma) => { if (busyLeft > 0) { busyLeft--; busyFlag = 1; return 0; } log.push(["load", ma]); return 0; },
    _usb_get: () => { if (busyLeft > 0) { busyLeft--; busyFlag = 1; return 0; } return 7; },
  };
  const timers = []; const schedule = (f) => { timers.push(f); return timers.length; };
  const run = () => { const t = timers.splice(0); t.forEach((f) => f()); };
  return { M, log, setBusy: (n) => { busyLeft = n; }, timers, run, setDead: (d) => { dead = d; }, isDead: () => dead, schedule };
}

{
  const f = fake(); const c = makeCaller(f.M, { dead: f.isDead, schedule: f.schedule, warn: () => {} });
  const p = c.alloc(8); f.M.HEAPU8.set([1, 2, 3, 4], p);
  f.setBusy(2);
  const r = c.call("usb_send", p, 4);
  check(c.busy && r === 0 && f.log.length === 0 && c.pending() === 1, "a busy write is queued, the call returns at once", `pending ${c.pending()}`);
  f.M.HEAPU8.set([9, 9, 9, 9], p);                       // the glue reuses its scratch buffer
  c.call("power_set_load", 55);                            // a later write waits behind the first one (order)
  check(c.pending() === 2 && f.log.length === 0, "a later write queues behind it");
  f.run();                                                 // still busy once more
  check(f.log.length === 0 && c.pending() === 2 && f.timers.length === 1, "retried from the scheduler, still busy: nothing lost, next try scheduled");
  f.run();
  check(JSON.stringify(f.log) === JSON.stringify([["send", [1, 2, 3, 4]], ["load", 55]]), "when the lock is free both go out in order, with the bytes as they were at the call", JSON.stringify(f.log));
  check(c.pending() === 0 && f.timers.length === 0 && c.stats.retried === 2, "and the retry timer stops");
}
{
  const f = fake(); const c = makeCaller(f.M, { dead: f.isDead, schedule: f.schedule });
  f.setBusy(1);
  const r = c.call("usb_get", 0);
  check(c.busy && r === 0 && c.pending() === 0 && f.timers.length === 0, "a busy read is not queued: the glue asks again at its next poll");
  check(c.call("usb_get", 0) === 7 && !c.busy, "and the next poll answers");
}
{
  const f = fake(); const c = makeCaller(f.M, { dead: f.isDead, schedule: f.schedule, warn: () => {}, maxTries: 3 });
  f.setBusy(1000); c.call("power_set_load", 1);
  f.run(); f.run(); f.run();
  check(c.pending() === 0 && c.stats.dropped === 1, "a write that stays busy for maxTries is dropped with a warning, not retried forever");
}
{
  const f = fake(); const c = makeCaller(f.M, { dead: f.isDead, schedule: f.schedule });
  f.setBusy(5); c.call("power_set_load", 1); f.setDead(true); f.run();
  check(c.pending() === 0 && f.log.length === 0 && c.call("usb_get", 0) === 0, "after stop the queue is dropped and nothing is called");
}
check(["ble_out_pop", "usb_recv", "power_get", "rfid_state", "dbfs_page_read", "ble_cfg_get"].every((n) => READ_EXPORT.test(n)) && !["usb_send", "ble_in", "power_set_load", "nfc_obj_near", "rfid_card_set", "dbnvs_set"].some((n) => READ_EXPORT.test(n)), "reads and writes are told apart by name");
process.exit(bad ? 1 : 0);
