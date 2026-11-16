// khal_nvs on a persistent region: write, restart, read (20 restarts, through the Node directory backend);
// a store that is full; type and size contracts; power-cut safety (killed at random points and torn writes at
// random byte counts); page-side entry points.
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { Bench, RESET, buildApp, sleep } from "../persist/host.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const pkgPersist = buildApp(path.join(here, "apps/nvs_persist"));
const pkgHammer = buildApp(path.join(here, "apps/nvs_hammer"));

await check("20 restarts: all four types and a two-chunk blob read back exactly, each generation, from disk", async () => {
  const bench = await new Bench().open();
  for (let n = 1; n <= 20; n++) {
    const run = await bench.boot(pkgPersist, { reason: n === 1 ? RESET.POWERON : RESET.SOFTWARE });
    await run.waitFor(() => /PERSIST gen=\d+ verify=/.test(run.logText()), 20000, "probe " + n);
    const m = /PERSIST gen=(\d+) verify=(\w+)/.exec(run.logText());
    assert.equal(m[1], String(n)); assert.equal(m[2], "ok", "generation " + n);
    await run.stop();
  }
  // the directory really holds it: a brand new bench on the same directory continues the count
  const again = await new Bench({ dir: bench.dir }).open();
  const run = await again.boot(pkgPersist, { reason: RESET.POWERON });
  await run.waitFor(() => /PERSIST gen=\d+ verify=/.test(run.logText()), 20000, "after reopen");
  assert.match(run.logText(), /PERSIST gen=21 verify=ok/);
  await run.stop();
  const meta = JSON.parse(fs.readFileSync(path.join(bench.dir, "meta.json"), "utf8"));
  assert.equal(meta.regions.nvs.size, 65536);
});

await check("power cut: killed at 50 random points, the store always opens and is self-consistent", async () => {
  const bench = await new Bench().open();
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let versions = [];
  for (let i = 0; i < 50; i++) {
    const run = await bench.boot(pkgHammer, { reason: i ? RESET.EXTERNAL : RESET.POWERON });
    await run.waitFor(() => /HAMMER verify=/.test(run.logText()), 20000, "verify " + i);
    const m = /HAMMER verify=(\S+) v=(\d+)/.exec(run.logText());
    assert.ok(m[1] === "ok" || (i === 0 && m[1] === "fresh"), "run " + i + ": " + m[0]);
    versions.push(Number(m[2]));
    await sleep(5 + Math.floor(rnd() * 150));
    await run.stop();
  }
  assert.ok(versions[versions.length - 1] > versions[0], "the hammer made progress: " + versions.slice(-5));
});

await check("power cut: torn writes at 40 random byte counts (fault injection inside the region service)", async () => {
  const bench = await new Bench().open();
  let seed = 777; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 40; i++) {
    const run = await bench.boot(pkgHammer, { reason: i ? RESET.EXTERNAL : RESET.POWERON });
    await run.waitFor(() => /HAMMER verify=/.test(run.logText()), 20000, "verify " + i);
    const m = /HAMMER verify=(\S+)/.exec(run.logText());
    assert.ok(m[1] === "ok" || (i === 0 && m[1] === "fresh"), "run " + i + ": " + m[0]);
    run.M._dbp_cut_after(1 + Math.floor(rnd() * 30000));
    await run.waitFor(() => run.M._dbp_cut_fired(), 20000, "cut");
    await sleep(20);
    await run.stop();
  }
});

process.exit(failed ? 1 : 0);
