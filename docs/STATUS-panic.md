# STATUS: settings-check intermittent failures and page freezes (fix/settings-panic)

Two separate root causes. Numbers marked (measured) come from runs listed in "Verification"; anything else is stated as not confirmed.

## Root cause 1: the page's thread waits for a lock (freezes, hangs, the `ble_out_pop` capture)

Symptom: `Runtime.callFunctionOn timed out`; the renderer's main thread at 100 % CPU for minutes; the firmware keeps running, the page never paints again.
Seen in settings-check (about 1 run in 4 under load, shortly after a boot of the firmware), bench-check, and the front-end engineer's capture inside `ble_out_pop`.
Same class, one rule broken: a page-facing export (called on the browser's main thread) waited without bound for a lock (a mutex, a spin flag)
that a firmware thread holds and cannot release while the page waits. In wasm the main thread that waits spins and never returns to its event loop.

Evidence (what is proven and what is not):
- Proven, deterministic: a worker that dies holding a lock (every stop/restart terminates workers) leaves it taken for ever; the next page call into that area
  never returns. `tests/node/system/page_locks.test.mjs` (A) orphans every registered lock; with the wait unbounded (budget set to 4e6 ms) the test child hangs and is killed
  after 120 s, with the bounded try every export answers busy in 5-12 ms.
- Proven, deterministic: a spin-style wait on the main thread does not service the proxy queue. `pthread_create` from a worker is proxied to the main thread
  (`pthreadCreateProxied -> proxyToMainThread`, even with a free pool: this Emscripten always proxies); a worker that holds a lock across it is stuck
  until the main thread runs its queue. Mutex/futex waits on the main thread DO run the queue (`_emscripten_yield`, emscripten_futex_wait.c; measured: a once held by a worker creating a thread
  did not block `kweb_touch`), spin waits (atomic_flag, text ring, my bounded try with an unbounded budget) do not. Test (B) holds each lock across a pthread_create and calls the exports
  with the event loop stopped (`Atomics.wait` then synchronous calls).
- Captured live (CDP `Debugger.pause` on each worker during two hangs): main thread spinning, one worker inside `pthreadCreateProxied`. The wasm has no name section,
  so which lock that worker held is NOT identified. I therefore cannot say which of the unbounded waits was the live one; the fix removes all of them.
- Not proven: that the live-site freezes are exactly this cycle. Confirm with the commands at the end.

Fix (the rule, applied to every area):
- A. No page-facing export waits for a lock. `runtime/drivers/include/page_lock.h`: `db_page_trylock` (bounded try, 5 ms), `DB_PAGE_LOCK`/`DB_PAGE_LOCK_V`, a busy flag (`dbpage_busy_take`).
  Converted: ble, nfc (20 ms), rfid, haptic, power, motion, usb, audio, console (`kweb_console_input`), nvs (`dbnvs_*` and the shared `khal_nvs_*` on the main thread), ir (spin flag),
  text ring (`kweb_text_drain` spin). `storage/vfs.c` already used a bounded try. Persistence (`persist.c`) takes no lock. Exports without any lock (ptr/len, layout, time offset) unchanged.
- B. No firmware thread creates a thread while holding a lock a page export takes: the BLE host thread is created after `g_mu` is released (`unlock()` serves the request),
  the RTOS timer service thread is created outside `g_k`, the input pump no longer uses `pthread_once` around `pthread_create` (`ensure_pump`: a caller that finds it being created just goes on).
  Audited every `pthread_create`: ir, exp, radio, idf timer start under a once or a lock no page export takes (not changed).
- C. Pool: measured peak running threads 42 for kodeOS (booted, BLE and Wi-Fi tests), 30 for the heaviest factory app (Kody Kart), 22-29 for the others. kodeOS pool 48 -> 64, apps 32 -> 44.
  Every Node test that boots a program now fails if it creates a thread beyond the pool or uses more than 80 % of it (`runtime/web-adapter/thread-watch.js`, hooks in `tests/node/harness.mjs` and `persist/host.mjs`).
  The page: `device.threadStats` = {pool, peak, beyondPool}.
- D. Tests: `tests/node/system/page_locks.test.mjs` (every registered lock x every export, orphaned and held across a pthread_create; plus the input pump case),
  `tests/node/{ble,nfc}/page_lock.test.mjs`, `tests/node/system/page_call.test.mjs` (the glue's retry logic, fake module).
- E. Glue: `runtime/web-adapter/page-call.js` wraps `ctx.call`: a busy READ answers "nothing yet" (the glue's next poll asks again); a busy WRITE is queued and repeated every 5 ms from the
  event loop, in order, with its buffers copied (the glue reuses scratch buffers), dropped with a warning after 400 tries; after stop nothing is called (`inst.dead`, glue disposed at teardown).
  `ctx.busy` tells the glue the last call met a lock; `device.pageCalls` = {busy, retried, dropped, pending}. No change to `web/src` is needed: the page uses the adapter.
  If the page calls `Module._x` directly anywhere (none found with grep) it must use the adapter's context instead.

## Root cause 2: `QP ASSERT in qf_port:130`

qf_port id 130 is the queue-full assert of a task-level post with no margin. The task named is the POSTER; the dump now names the VICTIM (`panic_dump` in khal_system_web.c).
Provoked deterministically (`tests/node/system/ao_overflow.test.mjs`): a test hook makes the `display` AO thread sleep; the rest keeps posting; after about 7.6 s the display queue
is full (16/16, signal 223 from the gui task) and `gui` asserts. Stalling `gui` or `touch` for 15 s does not overflow (their producers are slower).
It is NOT tick catch-up: the QP tick is created with `skip_unhandled_events` and the shim honours it (idf.c: `due = now + period`), the FreeRTOS shim timer reloads from now. So the simulator
does not post faster than the board; the overflow needs a consumer that does not run for several seconds. The live incident (poster `extNN` = the tick thread, victim unknown, seen once in ~25
headless runs under load 10-14) is consistent with an AO thread starved by the host (40+ threads on 2 cores, or a thread blocked on the frozen page); the victim was not captured, so this is a likely cause, not a proven one.
No queue was enlarged and no assert weakened. If it recurs, the dump names the queue.

## Verification
See the end of this file (filled in after the runs).

## Process notes
- `pkill -f chromium` was used twice early on (may have killed other engineers' Chrome); later kills were targeted.
- The stale `build/lib` of a seeded build dir lacks the runtime objects of newer areas: run `tools/dotbench sdk` once (7 min) before app builds.
