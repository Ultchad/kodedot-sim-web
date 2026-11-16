// The SDK's own khal_nvs host-test cases (tests/host_nvs/cases/test_khal_nvs.c, compiled UNCHANGED against a tiny Unity
// shim) run on the dotbench khal_nvs, then again after a restart with the store kept (the SDK's cases assume the flash
// outlives each case, so a second run over a populated store is a real test too).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Bench, RESET, appProject, assembleApp, buildApp, sdkDir } from "../persist/host.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };

const src = path.join(sdkDir(), "tests/host_nvs/cases/test_khal_nvs.c");
const unchanged = fs.readFileSync(src);
const proj = assembleApp("nvs_cases", appProject("nvs_cases", ["nvs_cases_main.c", "test_khal_nvs.c"], {
  "main/unity.h": { copy: path.join(here, "apps/nvs_cases/main/unity.h") },
  "main/nvs_cases_main.c": { copy: path.join(here, "apps/nvs_cases/main/nvs_cases_main.c") },
  "main/test_khal_nvs.c": { copy: src },
}));
assert.deepEqual(fs.readFileSync(path.join(proj, "main/test_khal_nvs.c")), unchanged, "SDK case file is used unmodified");
const pkg = buildApp(proj);

const bench = await new Bench().open();
let total = 0;
for (const round of [1, 2, 3]) {
  await check("SDK khal_nvs cases, round " + round + (round > 1 ? " (store survived a restart)" : ""), async () => {
    const run = await bench.boot(pkg, { reason: round === 1 ? RESET.POWERON : RESET.SOFTWARE });
    await run.waitFor(() => /NVS_CASES done/.test(run.logText()), 30000, "cases");
    const t = run.logText();
    const m = /NVS_CASES done n=(\d+) failed=(\d+)/.exec(t);
    const fails = t.split("\n").filter((l) => /FAIL|case FAILED/.test(l));
    await run.stop();
    assert.equal(Number(m[2]), 0, fails.join("\n"));
    assert.ok(Number(m[1]) >= 23, "cases run: " + m[1]);
    total = Number(m[1]);
  });
}
console.log("     " + total + " SDK cases per round");
process.exit(failed ? 1 : 0);
