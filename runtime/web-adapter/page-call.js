// SPDX-License-Identifier: GPL-3.0-or-later
// The page's side of the "never block the page" rule (runtime/drivers/include/page_lock.h, docs/STATUS-panic.md).
//
// A page-facing export that finds the firmware's lock taken for more than a few milliseconds does nothing and raises a busy flag
// (dbpage_busy_take). This wrapper sees the flag after every call:
//   - a READ (get, pop, poll, info ...) just answers what C returned ("nothing yet"); the glue asks again at its next poll;
//   - a WRITE (a setter, an inject, a send ...) is queued and tried again every few milliseconds, in order, from the page's event loop.
//     Its pointer arguments are copied at the time of the call (the glue reuses its scratch buffers), the copy is put back in a fresh
//     allocation at each retry. Nothing ever spins or waits here: the event loop must run so that a worker blocked on the main thread
//     (a pthread_create is proxied to it) can proceed and release the lock.
// After stop (dead) nothing is called and the queue is dropped.

/** Exports that only read or pop: a busy answer is not retried. Everything else is treated as a write. */
export const READ_EXPORT = /(_get|_pop|_poll|_read|_recv|_info|_state|_stat|_stats|_list|_json|_layout|_usage|_obj_id|_is_near|_frame|_ptr|_len|_count|_name|_size|_flags|_bits|_gen|_index_of|_offset_ms|_cut_fired|_scratch|_mounted|_take|_cfg_get|_type|_key|_namespace|_read_blob)$/;

export function makeCaller(M, { dead = () => false, retryMs = 5, maxTries = 400, queueMax = 512, warn = (...a) => console.warn(...a), schedule = (f, ms) => setTimeout(f, ms) } = {}) {
  const live = new Map();            // ptr -> size, every block the glue got from alloc()
  // One queue per area (the export's prefix: usb_, power_, ble_ ...). Order matters only inside an area, whose exports share a lock;
  // a write of another area is never held back behind a busy one. That matters for more than speed: glue with its own busy protocol
  // and implicit state (the storage API puts the path in a scratch buffer, then calls dbfs_page_*) must get its real answer at once.
  const queues = new Map();
  let timer = null, lastBusy = false;
  const stats = { busy: 0, retried: 0, dropped: 0 };

  const take = () => (typeof M._dbpage_busy_take === "function" ? M._dbpage_busy_take() : 0);
  const isRead = (fn) => READ_EXPORT.test(fn);
  const areaOf = (fn) => { const i = fn.indexOf("_"); return i < 0 ? fn : fn.slice(0, i); };
  const pendingCount = () => { let n = 0; for (const q of queues.values()) n += q.length; return n; };

  function snapshot(args) {
    return args.map((a) => {
      if (typeof a !== "number" || !Number.isInteger(a) || a <= 0) return a;
      for (const [p, n] of live) if (a >= p && a < p + n) return { ptr: a, base: p, off: a - p, bytes: M.HEAPU8.slice(p, p + n) };
      return a;
    });
  }
  function run(fn, args) {                           // args may hold snapshots: put each back in a fresh block, call, free
    const temps = [];
    const real = args.map((a) => {
      if (a === null || typeof a !== "object") return a;
      const p = M._malloc(a.bytes.length); temps.push(p);
      M.HEAPU8.set(a.bytes, p);
      return p + a.off;
    });
    try { take(); return M["_" + fn](...real); } finally { for (const p of temps) M._free(p); }
  }
  function drain() {
    timer = null;
    if (dead()) { queues.clear(); return; }
    for (const [area, queue] of queues) {
      while (queue.length) {
        const e = queue[0];
        run(e.fn, e.args);
        if (take()) {                                 // still busy: keep it at the head (order matters), look again soon
          if (++e.tries >= maxTries) { queue.shift(); stats.dropped++; warn(`page-call: ${e.fn} stayed busy for ${maxTries} tries and was dropped`); continue; }
          break;
        }
        queue.shift(); stats.retried++;
      }
      if (!queue.length) queues.delete(area);
    }
    if (queues.size) timer = schedule(drain, retryMs);
  }
  function enqueue(fn, args) {
    const area = areaOf(fn);
    let queue = queues.get(area);
    if (!queue) queues.set(area, (queue = []));
    if (queue.length >= queueMax) { const old = queue.shift(); stats.dropped++; warn(`page-call: queue full, the oldest write (${old?.fn}) was dropped`); }
    queue.push({ fn, args: snapshot(args), tries: 0 });
    if (!timer) timer = schedule(drain, retryMs);
  }

  return {
    stats,
    /** Same as the old ctx.call, plus the busy handling above. */
    call(fn, ...args) {
      if (dead()) return 0;
      const write = !isRead(fn);
      if (write && queues.get(areaOf(fn))?.length) { enqueue(fn, args); return 0; }     // keep the order of this area's writes
      take();                                                          // forget a refusal that was not ours
      const r = M["_" + fn](...args);
      lastBusy = take() > 0;
      if (lastBusy) { stats.busy++; if (write) enqueue(fn, args); }
      return r;
    },
    /** Did the last call() meet a taken lock? (the result of a read is then "nothing yet", not an answer) */
    get busy() { return lastBusy; },
    alloc(n) { const p = M._malloc(n); live.set(p, n); return p; },
    free(p) { live.delete(p); M._free(p); },
    pending: () => pendingCount(),
    dispose() { queues.clear(); if (timer) clearTimeout(timer); timer = null; },
  };
}
