// Same rule as tests/node/ble/page_lock.test.mjs for the NFC bench: the page's thread never waits unboundedly for the store lock.
// A thread takes it and exits holding it (a terminated worker); every page export must answer -9 (busy) within milliseconds.
import { spawnSync } from "node:child_process";
import { Bench, RESET, sleep, pkgPath } from "../persist/host.mjs";

if (process.argv[2] !== "--child") {
  const r = spawnSync(process.execPath, ["--expose-gc", new URL(import.meta.url).pathname, "--child"], { encoding: "utf8", timeout: 60000 });
  process.stdout.write(r.stdout ?? "");
  if (r.status !== 0) { console.log("FAIL - the page thread hung or failed on an orphaned NFC lock (exit " + r.status + ", signal " + r.signal + ")\n" + (r.stderr ?? "").slice(-800)); process.exit(1); }
  process.exit(0);
}
const bench = await new Bench({ memory: true }).open();
const a = await bench.boot(pkgPath("kodeos"), { reason: RESET.POWERON });
await a.waitFor(() => a.logText().includes("kaos.nfc up"), 90000, "kodeOS up");
await sleep(1000);
const M = a.M, p = M._malloc(256);
let bad = 0;
const check = (ok, name, d = "") => { if (!ok) bad++; console.log((ok ? "ok   - " : "FAIL - ") + name + (d !== "" ? "  " + d : "")); };
check(M._nfc_state(p) >= 0, "before: nfc_state answers");
M._nfc_test_orphan_lock();
const t0 = Date.now();
const r = [M._nfc_state(p), M._nfc_event_pop(p), M._nfc_obj_info(1, p), M._nfc_obj_create(1), M._nfc_obj_near(1, 1)];
const dt = Date.now() - t0;
check(r.every((x) => x === -9), "with the lock orphaned every page export answers busy (-9)", JSON.stringify(r));
check(dt < 1000, "and none of them waits long", dt + " ms");
process.exit(bad ? 1 : 0);
