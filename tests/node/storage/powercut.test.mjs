// Power-cut safety of the FAT volumes. A hammer app rewrites 24 files forever (generation g into slot g%24); at every boot it
// verifies what the previous run left. The device is stopped at random points 50 times (the workers are terminated mid-write),
// then 40 more times with torn writes (dbp_cut_after: the write that straddles the limit is cut, later ones are dropped).
// Each time the volume must mount without being re-formatted, every file but the one being written must be whole, and nothing
// the previous run reported as done may be lost.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bench, RESET, appProject, assembleApp, buildApp, sleep } from "../persist/host.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const rnd = (() => { let s = 20260516; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; })();

const hammer = (name) => buildApp(assembleApp(name, appProject(name, [name + "_main.c"], {
  ["main/" + name + "_main.c"]: { copy: path.join(here, "apps", name, "main", name + "_main.c") },
  "main/fs_hammer.h": { copy: path.join(here, "apps/fs_hammer/main/fs_hammer.h") },
})));

const verifyOf = (t) => {
  const all = [...t.matchAll(/FSHAM verify=(\S+) maxWhole=(\d+) whole=(\d+) bad=(\d+)/g)];
  const m = all[0];
  return m && { verdict: m[1], maxWhole: +m[2], whole: +m[3], bad: +m[4] };
};
const lastDone = (t) => { let g = 0; for (const m of t.matchAll(/FSHAM DONE (\d+)/g)) g = Math.max(g, +m[1]); return g; };

async function campaign(pkg, label, cut) {
  const bench = await new Bench().open();
  let expectAtLeast = 0, cutsFired = 0;
  const N = cut ? 40 : 50;
  for (let i = 0; i < N; i++) {
    const run = await bench.boot(pkg, { reason: i === 0 ? RESET.POWERON : RESET.EXTERNAL });
    await run.waitFor(() => /FSHAM verify=/.test(run.logText()), 20000, "verify line (run " + i + ")");
    const v = verifyOf(run.logText());
    assert.equal(v.verdict, "ok", `run ${i}: ${JSON.stringify(v)}`);
    if (i > 0) assert.ok(v.whole >= 1 && v.maxWhole >= expectAtLeast, `run ${i}: lost files: maxWhole ${v.maxWhole} < done ${expectAtLeast} (${JSON.stringify(v)})`);
    const budget = cut ? Math.floor(rnd() * 60000) : 0;
    if (cut) run.M._dbp_cut_after(budget);
    await sleep(150 + Math.floor(rnd() * 700));
    if (cut && run.M._dbp_cut_fired()) cutsFired++;
    const t = run.logText();
    // without a cut, everything logged as done is durable; with one, only what was done before it fired is promised
    if (!cut) expectAtLeast = Math.max(expectAtLeast, lastDone(t));
    else { const w = verifyOf(t); expectAtLeast = Math.max(expectAtLeast, w.maxWhole); }
    await run.stop();
  }
  return { cutsFired };
}

const fsPkg = hammer("fs_hammer");
await check("FAT volume /storage: stopped mid-write at 50 random points; mounts, earlier files intact", async () => { await campaign(fsPkg, "kill", false); });
await check("FAT volume /storage: 40 torn writes (cut at random byte counts); mounts, earlier files intact", async () => {
  const r = await campaign(fsPkg, "cut", true);
  assert.ok(r.cutsFired >= 10, "enough cuts actually fired: " + r.cutsFired);
});
process.exit(failed ? 1 : 0);
