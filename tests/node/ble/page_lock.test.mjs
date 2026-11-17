// The page's thread must never block on a lock a firmware thread cannot release (docs/STATUS-panic.md, "main thread freeze").
// In a browser a main thread waiting for a mutex spins inside wasm and never returns to the event loop, so one worker that holds
// the BLE host's lock when the host terminates it (every stop/restart does that) froze the whole page at the next poll.
// Deterministic: a test hook makes a thread take the lock and exit holding it (exactly what a terminated worker leaves behind),
// then the page-facing exports are called from the main thread. Before the fix the call never returns (the child is killed after
// 60 s and the test fails); after it every call answers "busy" within milliseconds.
import { spawnSync } from "node:child_process";
import { Bench, RESET, sleep, pkgPath } from "../persist/host.mjs";

if (process.argv[2] !== "--child") {
  const r = spawnSync(process.execPath, ["--expose-gc", new URL(import.meta.url).pathname, "--child"], { encoding: "utf8", timeout: 60000 });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.log("FAIL - the page thread hung or failed on an orphaned BLE lock (exit " + r.status + ", signal " + r.signal + ")\n" + (r.stderr ?? "").slice(-800)); process.exit(1); }
  process.exit(0);
}
const bench = await new Bench({ memory: true }).open();
const a = await bench.boot(pkgPath("kodeos"), { reason: RESET.POWERON });
await a.waitFor(() => a.logText().includes("kaos.radio"), 90000, "kodeOS up");
await sleep(1500);
const M = a.M, p = M._malloc(4096);
let bad = 0;
const check = (ok, name, d = "") => { if (!ok) bad++; console.log((ok ? "ok   - " : "FAIL - ") + name + (d !== "" ? "  " + d : "")); };
check(M._ble_info(p, 4096) > 0, "before: ble_info answers");
M._ble_test_orphan_lock();
const t0 = Date.now();
const out = M._ble_out_pop(p, 2048), info = M._ble_info(p, 4096), gatt = M._ble_gatt_json(p, 4096), rc = M._ble_in(p, 4);
M._ble_cfg(0, 0); M._ble_cfg_get(0);
const dt = Date.now() - t0;
check(out === 0 && info === 0 && gatt === 0 && rc === -3, "with the lock orphaned every page export answers busy", JSON.stringify({ out, info, gatt, rc }));
check(dt < 1000, "and none of them waits long", dt + " ms");
process.exit(bad ? 1 : 0);
