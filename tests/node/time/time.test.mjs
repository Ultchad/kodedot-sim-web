// Time: the wall clock comes from the host at boot; a clock set by the page (time.js) or by the firmware (`time set=`) is an
// offset on the host clock kept in the persistent region "dev-state" (so it survives reset, power-off and a page reload);
// the zone is the firmware's own setting (POSIX TZ string in NVS, applied at boot by AO_Boot) and the C library applies it.
import assert from "node:assert/strict";
import path from "node:path";
import { Bench, RESET, pkgPath, sleep, glueMods, appProject, assembleApp, buildApp } from "../persist/host.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
async function cli(run, line, ms = 6000) {
  const start = run.logText().length;
  run.console(line);
  const t0 = Date.now();
  for (;;) {
    const t = strip(run.logText().slice(start));
    if (/^>(ok|err .*)$/m.test(t)) return { text: t };
    if (Date.now() - t0 > ms) throw new Error("no reply to: " + line + "\n" + t);
    await sleep(25);
  }
}
const tmm = await glueMods.time();
const utcOf = (text) => Date.parse(/utc="([^"]+)"/.exec(text)[1]);
const boot = async (bench, reason) => { const run = await bench.boot(pkgPath("console_actions"), { reason }); await run.waitFor(() => /kode>/.test(run.logText()), 20000, "console"); return run; };

await check("the clock starts at the host's wall clock", async () => {
  const bench = await new Bench().open();
  const run = await boot(bench, RESET.POWERON);
  const tm = run.glue(tmm);
  assert.ok(Math.abs(tm.now() - Date.now()) < 1500 && Math.abs(tm.offsetMs()) < 1500);
  const r = await cli(run, "time");
  assert.match(r.text, /state=known/); assert.ok(Math.abs(utcOf(r.text) - Date.now()) < 3000, r.text);
  await run.stop();
});

await check("a clock set by the page survives a reset, a power cycle and a new page (a new bench over the same store)", async () => {
  const bench = await new Bench().open();
  let run = await boot(bench, RESET.POWERON);
  const target = Date.UTC(2031, 5, 7, 8, 9, 10);
  run.glue(tmm).set(target);
  assert.ok(Math.abs(utcOf((await cli(run, "time")).text) - target) < 3000, "the firmware sees it");
  await run.stop();
  run = await boot(bench, RESET.EXTERNAL);                     // reset
  assert.ok(Math.abs(run.glue(tmm).now() - target) < 4000, "after reset: " + new Date(run.glue(tmm).now()).toISOString());
  await run.stop();
  run = await boot(bench, RESET.POWERON);                      // power-on
  assert.ok(Math.abs(run.glue(tmm).now() - target) < 6000, "after power-on");
  await run.stop();
  const reloaded = await new Bench({ dir: bench.dir }).open();  // page reload: only the durable store is left
  run = await boot(reloaded, RESET.POWERON);
  assert.ok(Math.abs(run.glue(tmm).now() - target) < 8000, "after a reload");
  run.glue(tmm).resetToHost();
  assert.ok(Math.abs(run.glue(tmm).now() - Date.now()) < 1500, "back on the host clock");
  await run.stop();
});

await check("a clock set by the firmware (`time set=`) is kept too; the offset lives in dev-state, not in a second place", async () => {
  const bench = await new Bench().open();
  let run = await boot(bench, RESET.POWERON);
  const r = await cli(run, 'time set="2040-02-03T04:05:06Z"');
  assert.ok(Math.abs(utcOf((await cli(run, "time")).text) - Date.UTC(2040, 1, 3, 4, 5, 6)) < 3000, r.text);
  await run.stop();
  run = await boot(bench, RESET.EXTERNAL);
  assert.ok(Math.abs(run.glue(tmm).now() - Date.UTC(2040, 1, 3, 4, 5, 6)) < 5000);
  assert.ok(bench.pm.image.regions.get("dev-state").chunks.size === 1, "one 4 KiB region holds it");
  await run.stop();
});

await check("zone: `config key=zone` is stored in NVS, applied at boot, and the C library renders local time with DST", async () => {
  const bench = await new Bench().open();
  let run = await boot(bench, RESET.POWERON);
  await cli(run, 'config key="zone" value="CET-1CEST,M3.5.0,M10.5.0/3"');
  await run.stop();
  run = await boot(bench, RESET.EXTERNAL);
  assert.match(strip(run.logText()), /zone: CET-1CEST,M3\.5\.0,M10\.5\.0\/3 \(stored\)/, "applied at boot from the stored setting");
  await run.stop();
  const name = "tz_probe";
  const pkg = buildApp(assembleApp(name, appProject(name, [name + "_main.c"], { ["main/" + name + "_main.c"]: { copy: path.join(here, "apps", name, "main", name + "_main.c") } })));
  run = await bench.boot(pkg, { reason: RESET.EXTERNAL });
  await run.waitFor(() => /TZ july-ny/.test(run.logText()), 20000, "probe");
  const t = run.logText();
  assert.match(t, /TZ set=1/);
  assert.match(t, /TZ july 2026-07-01 14:00 dst=1/);
  assert.match(t, /TZ jan 2026-01-15 13:00 dst=0/);
  assert.match(t, /TZ july-ny 2026-07-01 08:00 dst=1/);
  await run.stop();
});
process.exit(failed ? 1 : 0);
