// Root cause 2 (docs/STATUS-panic.md): "QP ASSERT qf_port:130 (task 'extNN' / any poster)" means a task-level post found the target Active
// Object's queue full: the consumer was not running for as long as the producers needed to fill it. The assert names the POSTER; the panic
// dump added to khal_panic names the VICTIM. A test hook makes the display AO's thread sleep (as a thread the host scheduler starves would),
// the rest of the firmware keeps posting, and the dump must show which queue overflowed. Nothing here is a catch-up burst: the QP tick
// timer is created with skip_unhandled_events and the shim honours it (idf.c), so the tick never posts faster than the board's does.
import { Bench, RESET, sleep, pkgPath } from "../persist/host.mjs";
const bench = await new Bench({ memory: true }).open();
const a = await bench.boot(pkgPath("kodeos"), { reason: RESET.POWERON });
await a.waitFor(() => a.logText().includes("kaos.radio"), 90000, "kodeOS up");
await sleep(1500);
let bad = 0;
const check = (ok, name, d = "") => { if (!ok) bad++; console.log((ok ? "ok   - " : "FAIL - ") + name + (d !== "" ? "  " + d : "")); };
const p = a.M._malloc(32); a.M.HEAPU8.set(Buffer.from("display\0"), p);
a.M._dotbench_rtos_test_stall(p, 30000);
const t0 = Date.now();
await a.waitFor(() => /QP ASSERT in qf_port:130/.test(a.logText()), 40000, "the queue of the stalled AO to overflow");
const log = a.logText(), dt = Date.now() - t0;
const dump = log.split("\n").filter((l) => l.includes("panic-dump"));
check(true, "a stalled consumer overflows its queue and the poster asserts (130)", `after ${dt} ms`);
check(dump.some((l) => /AO prio=\d+ display used=(\d+)\/\1 /.test(l)), "the panic dump names the victim: the display AO, queue full", dump.find((l) => l.includes(" display ")) ?? dump.join(" | "));
check(dump.some((l) => /thread \S+ /.test(l)), "and the poster", dump.find((l) => l.includes("thread")) ?? "");
process.exit(bad ? 1 : 0);
