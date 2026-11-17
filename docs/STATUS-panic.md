# STATUS: settings-check intermittent failures (fix/settings-panic)

FINAL STATE (handed back early at the coordinator's request). The settings-check failures are NOT confirmed fixed.

## Symptoms (three distinct ones, all load dependent)
1. Firmware panic `QP ASSERT in qf_port:130 (task 'extNN')`.
   - qf_port id 130 is `Q_ASSERT_INCRIT(130, margin != QF_NO_MARGIN)` in `QActive_post_`: a task-level post with no margin
     found the target AO's queue full. The task name is the POSTER, the victim AO is not named (kqp_bsp.c says so).
   - `extNN` is a thread the RTOS shim adopted on first use (`self()` in runtime/rtos/src/rtos.c, name "ext<id>"): not an AO task.
     Task-level posts from such a thread are QTimeEvt expiries from the soft-timer service thread (kqp_tick, 1000 Hz), the
     input pump posts via the ISR path (id 630, not 130). So the poster is the QP tick thread and the victim is an AO that
     stopped draining for longer than (queue length x period of one of its periodic time events).
   - Seen once in ~25 headless Chrome runs (two loops in parallel, load 10-14): right after `kgui sheet open: time`, i.e. while
     kgui renders a heavy screen. Never in Node (36 stop/start rounds with touch, flushPersist 150/700 ms/1 Hz, burners up to load 22).
   - The victim AO is NOT yet identified (the panic-dump below was added after that capture).
2. Page main thread freeze (the "hangs"): `Runtime.callFunctionOn timed out`, renderer main thread at ~100 % CPU for minutes
   (Emscripten spins on the main thread when a wasm call waits on a mutex/futex; the event loop never runs again).
   - Happens in settings-check (about 1 run in 4 under load: 4 hangs seen, always shortly after a boot of the firmware: a reload,
     a new tab or the very first boot) and in bench-check (bench_1 here, and the front-end engineer's capture inside `ble_out_pop`).
   - Ruled out: the page's text-ring drain starving (a debug thread watching head/tail/lock never printed), persistence flush
     (runtime/persist/persist.c is lock free; only JS memcpy).
   - Same CLASS as the BLE report: the page's thread calls an export that takes a firmware-held mutex (ble_host.c `api_lock` ->
     `g_mu`, also `pthread_once` for init). Not yet proven which lock/holder; thread-level capture still to do.
3. "kodeOS did not report the change" (UI desync): a gesture goes astray ("kgui gesture: release ... -> back") when the machine is
   slow; fixed sleeps in the check, touch hold 120 ms read by a 10 ms poll. Looks like test timing, not firmware; not investigated further.

## Rates (headless Chrome, scratch copy of web/ at /tmp/panic/site, kodeOS built here)
- Alone-ish (load 2-4): settings-check 11 runs: 2 failures early (1 UI desync, 1 freeze), then 5 passes in a row.
- Two loops in parallel (load 7-14): 10 runs: 4 failures (hang x2, UI desync x2) plus 1 panic in another batch of 8 (also 1 hang).
- bench-check (load 4-5): run 1 freeze (ProtocolError), run 2 20 PASS.
- Overall settings-check about 30 to 40 % failure, consistent with the brief.

## What changed (committed)
- `runtime/drivers/ble/ble_host.c`: every page-facing export (`ble_in`, `ble_out_pop`, `ble_cfg`, `ble_cfg_get`, `ble_stat`, `ble_set_addr`,
  `ble_info`, `ble_gatt_json`, `ble_bond_inject`, `ble_reset_counters`) takes `g_mu` through `page_lock(budget_ms)`: a bounded
  `pthread_mutex_trylock` loop (5 ms for polls, 50 ms for config writes). On failure the export answers "busy" (`ble_in` -3, pops/info 0).
  The page asks again at its next poll. Rule: the page's thread never waits unboundedly for a lock a firmware thread can hold.
- `runtime/web-adapter/dotbench-device.js`: `_teardown` marks the instance dead first and disposes every area glue (ble.js has timers: a 10 ms
  scan interval, `later()` timeouts) and `ctx.call` returns 0 for a dead instance. Before, those timers kept calling into a module whose
  workers had just been terminated, possibly while one held a lock: the main thread then spun forever (100 % CPU, protocol timeouts).
- `runtime/drivers/system/khal_system_web.c` (+ two helpers in rtos.c): `panic_dump()` at every panic prints each AO queue with its queued signals and the
  panicking thread, so a "queue full" assert names the victim next time.
- `tests/node/ble/page_lock.test.mjs`: a hook (`ble_test_orphan_lock`) makes a thread take g_mu and exit holding it (what a terminated worker leaves),
  then calls the page exports on the main thread. Before the fix the child hangs (killed after 60 s: FAIL, verified), after it every call
  answers busy in < 100 ms (PASS). Deterministic, no timing.

## Honest state of the evidence
- Orphaned/held lock freeze: the mechanism is demonstrated (test above) and the code path exists in the page (stale glue timers after stop/restart).
  I did NOT capture a live freeze showing which lock and holder (Debugger.pause and a diagnostic thread both failed to report: the stuck call was
  not seen from the page). So I cannot claim the settings-check hangs are this bug; see the after-fix rates below.
- Panic: the poster is the esp_timer/tick thread, the victim AO is not identified. Stalling any single AO for up to 4 s by a test hook (not committed)
  did NOT reproduce the assert, so a simple stall of one AO is not enough; it needs a sustained flood into one queue. Unresolved.
- Audit of other page-facing exports taking firmware-held locks with an unbounded wait (NOT changed): rfid_bench.c, haptic_aw86233.c,
  power_model.c, radio_host.c, khal_nvs_web.c (dbnvs_*), usb_cable.c, motion_model.c, exp_link.c, khal_console_web.c (`kweb_console_input`, used by
  settings-check's `config`), audio_bench.c; `kweb_text_drain` (spin lock on the text ring). storage/vfs.c already uses a bounded try. The same
  `page_lock` helper applies to each; the holders there only hold for short memory work, so they were not changed without evidence.


## Update at hand-back
Worker stacks captured with CDP Debugger.pause on each worker while the main thread was hung (two hangs, same shape): the main thread spins
in wasm on a lock; one worker is inside `pthreadCreateProxied -> proxyToMainThread` (kodeOS has PTHREAD_POOL_SIZE=48 and 35+ threads, so
a worker's pthread_create waits for the main thread's event loop). Deadlock: main waits for a lock the blocked worker holds, the worker waits for main.
The wasm has no name section, so the lock/holder in that worker (call chain func2369<func1858<func600<func366<func364) is NOT named.
Known pthread_create-under-lock sites: the RTOS timer service (`timer_make`, was under g_k, fixed: claimed under g_k, spawned outside) and
`ble_host.c start_locked -> ensure_thread()` under g_mu (NOT fixed). Also changed: NFC page exports use a bounded 20 ms try (`nfc_lock_page`, -9 when busy),
tests/node/nfc/page_lock.test.mjs.

Post-fix measurements (headless Chrome, sequential, load 3-8 for bench-check, 11-29 for settings-check because other engineers and my own SDK rebuild ran):
- bench-check x6: 4 clean (20 PASS), 1 with 2 UI fails, 1 freeze (only 2 PASS): a freeze remains.
- settings-check x12: 6 pass, 6 fail (3x "did not report the change", 1 navigation timeout, 2 more same class), 0 panics. Not better than before (2-3 in 5),
  failures are UI-timing class under load > 11; this is not a valid 20-run verification and I did not do it.
Node suites (build dir with rebuilt SDK libs): ble, persist, nfc, nvs via tests/node/run.sh: ALL TESTS PASSED; kodeos/run.sh PASSED;
boot/run.sh FAILED at "a sticky request survives the keep list; BOT+LEFT ..." (timeout waiting for kodeOS, load 29-38; not rerun on main).
Note: the stale build/lib had to be rebuilt (`tools/dotbench sdk`, 7 min) before app builds linked.
