// Restart / reset: the firmware asks for a restart, the host tears every worker down and boots again,
// repeatedly, without leaking workers, threads or memory; the reset reason reaches the next boot;
// the keep store and NVS survive a restart, RAM does not.
import assert from "node:assert/strict";
import fs from "node:fs";
import { boot, BTN, pkgPath, RESET, sleep } from "../harness.mjs";

let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); }
  catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};
const proc = () => {
  const st = fs.readFileSync("/proc/self/status", "utf8");
  return { threads: Number(st.match(/Threads:\s+(\d+)/)[1]), rssMB: Number(st.match(/VmRSS:\s+(\d+)/)[1]) / 1024 };
};
const settle = async () => { await sleep(300); if (global.gc) { global.gc(); await sleep(100); global.gc(); } };

await check("banner shows the real name and the reset reason", async () => {
  const a = await boot(pkgPath("buttons_led"), { reason: RESET.POWERON });
  await a.waitFor(() => a.logText().includes("buttons_led green"), 15000, "boot");
  const t = a.logText();
  assert.match(t, /kode buttons_led 0\.0\.0 \(/);
  assert.match(t, /kode reset power-on/);
  assert.doesNotMatch(t, /kode \? \?/);
  assert.doesNotMatch(t, /reset unknown/);
  a.shutdown();
});

await check("firmware restart (bottom button) is signalled with a reason", async () => {
  const a = await boot(pkgPath("buttons_led"));
  await a.waitFor(() => a.logText().includes("buttons_led green"), 15000, "boot");
  a.button(BTN.BOT, true); await sleep(200); a.button(BTN.BOT, false);
  await a.waitFor(() => a.restartRequested(), 10000, "restart request");
  const info = a.restartInfo();
  assert.equal(info.reason, RESET.SOFTWARE);
  assert.equal(info.seq, 1);
  a.shutdown();
});

await check("keep store and NVS survive restarts, RAM state does not, reason is passed on", async () => {
  let persist = new Map(), reason = RESET.POWERON;
  for (let n = 1; n <= 5; n++) {
    const a = await boot(pkgPath("reset_probe"), { reason, persist, bootCount: n });
    await a.waitFor(() => a.restartRequested(), 15000, "probe restart #" + n);
    const m = a.logText().match(/probe boot reason=(\d+) keep=(\d+) nvs=(\d+) ram=(\d+)/);
    assert.ok(m, "probe line missing: " + a.logText());
    assert.deepEqual(m.slice(1).map(Number), [reason, n, n, 1], "boot " + n);
    assert.equal(a.restartInfo().reason, RESET.SOFTWARE);
    persist = a.snapshot();
    a.shutdown();
    reason = a.restartInfo().reason;
  }
  // a power-on (empty persist) starts from scratch
  const a = await boot(pkgPath("reset_probe"), { reason: RESET.POWERON });
  await a.waitFor(() => a.restartRequested(), 15000, "probe after power-on");
  assert.match(a.logText(), /probe boot reason=1 keep=1 nvs=1 ram=1/);
  a.shutdown();
});

await check("20 restarts alternating the two examples: workers, threads and memory stay flat", async () => {
  const apps = ["buttons_led", "display_lvgl"];
  const samples = [];
  let persist = new Map(), reason = RESET.POWERON;
  for (let n = 0; n < 20; n++) {
    const name = apps[n % 2];
    const a = await boot(pkgPath(name), { reason, persist, bootCount: n + 1 });
    if (name === "buttons_led") await a.waitFor(() => a.logText().includes("buttons_led green"), 15000, "led boot");
    else await a.waitFor(() => a.frameSeq() > 0, 15000, "first frame");
    const w = a.workers();
    persist = a.snapshot();
    a.shutdown();
    assert.equal(a.workers(), 0 + a.M.PThread.unusedWorkers.length, "running workers after shutdown");
    reason = RESET.SOFTWARE;
    await settle();
    samples.push({ n, name, workers: w, ...proc() });
  }
  console.log("     sample  app            workers threads rssMB");
  for (const s of samples.filter((_, i) => i % 4 === 3 || i < 2)) console.log("     #" + String(s.n).padStart(2) + "     " + s.name.padEnd(14) + " " + String(s.workers).padStart(5) + "   " + String(s.threads).padStart(5) + "  " + s.rssMB.toFixed(0));
  const base = samples[3];   // after both apps ran twice
  const last = samples[samples.length - 1];
  assert.ok(last.threads <= base.threads + 1, `threads grew ${base.threads} -> ${last.threads}`);
  assert.ok(last.rssMB <= base.rssMB + 80, `rss grew ${base.rssMB.toFixed(0)} -> ${last.rssMB.toFixed(0)} MB`);
  const ws = samples.map((s) => s.workers);
  assert.ok(Math.max(...ws) - Math.min(...ws) <= 1, "worker count varied: " + ws);
});

console.log(failed ? "restart: FAILED" : "restart: PASSED");
process.exit(failed ? 1 : 0);
