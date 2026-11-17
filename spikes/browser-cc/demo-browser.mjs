// Headless Chrome demo + measurements. The page is served with the production COOP/COEP/CSP headers; the toolchain runs in a blob Worker;
// the compiled sketch becomes a .dotpart and runs on the real part runtime (the same scenario files as the offline-built parts).
// Usage: NODE_PATH=/home/claude/dotbench/web/node_modules node demo-browser.mjs [--keep-open]
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execSync } from "node:child_process"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const PARTS = ["esp32-blink-echo", "esp32-i2c-slave", "esp32-button-led"];
const R = { notes: [] }; let failed = false;
const say = (s) => console.log(s); const ms = (x) => Math.round(x);
const rssOf = (tag) => { try { return execSync(`ps -eo rss,args | grep -- '${tag}' | grep -v grep | awk '{s+=$1} END{print s}'`).toString().trim() * 1024; } catch { return null; } };

const S = await startServer({ compress: "br" });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ccprof-"));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--user-data-dir=" + profile] });
const page = await browser.newPage();
const errors = [], csp = [], outside = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t); if (process.env.VERBOSE) say("[page] " + t); });
page.on("request", (r) => { const u = r.url(); if (!u.startsWith(S.url) && !u.startsWith("blob:") && !u.startsWith("data:")) outside.push(u); });
page.on("workercreated", (w) => { if (process.env.VERBOSE) say("[worker] " + w.url()); });
const check = (name, ok, extra = "") => { if (!ok) failed = true; say(`${ok ? "ok  " : "FAIL"} - ${name}${extra ? "  " + extra : ""}`); };

await page.goto(S.url + "/"); await page.waitForFunction("window.READY === true", { timeout: 30000 });
check("page is cross-origin isolated", await page.evaluate(() => crossOriginIsolated));
const rss0 = rssOf(profile), mem0 = await page.evaluate(() => CC.memory());

// ---- cold start: empty profile, empty Cache API ----
const t0 = Date.now(); const bytes0 = S.stats.bytes;
const cold = await page.evaluate(() => CC.start());
R.cold = { wall_ms: ms(cold.wall), ms: cold.ms, assetMs: cold.stats.ms, fetched: cold.stats.fetched, transferBytes: S.stats.bytes - bytes0 };
say(`cold start: ${ms(cold.wall)} ms wall on loopback (fetch+compile assets ${ms(cold.ms.assets)}, import ${ms(cold.ms.import)}, first run ${ms(cold.ms.firstRun)}); transferred ${((S.stats.bytes - bytes0) / 1e6).toFixed(2)} MB brotli(5) from the server`);
say("  per asset ms: " + JSON.stringify(cold.stats.ms));
R.rssAfterLoad = rssOf(profile);

// ---- the three example sketches ----
R.sketches = {};
for (const name of PARTS) {
  const tests = []; for (const f of fs.readdirSync(path.join(ROOT, "parts", name, "tests")).filter((x) => x.endsWith(".test.json")).sort()) tests.push(JSON.parse(fs.readFileSync(path.join(ROOT, "parts", name, "tests", f), "utf8")));
  const r = await page.evaluate((n, t) => CC.build(n, t), name, tests);
  check(`${name}: compiled in the worker, accepted by the importer`, r.ok, r.ok ? `cc ${ms(r.ms.cc)} + link ${ms(r.ms.ld)} = ${ms(r.ms.total)} ms, wasm ${r.wasm} B, .dotpart ${r.pkg} B` : JSON.stringify(r.importer ?? r.stderr));
  for (const s of r.scenarios ?? []) check(`${name}: scenario "${s.name}" (${s.steps} steps)`, s.ok, s.ok ? "" : s.error);
  if (r.stderr?.trim()) say("  compiler output: " + r.stderr.trim());
  R.sketches[name] = { wasm: r.wasm, pkg: r.pkg, ms: r.ms, scenarios: r.scenarios?.map((s) => ({ name: s.name, ok: s.ok, steps: s.steps })) };
}

// ---- recompile timing (warm) ----
{
  const name = PARTS[0], manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "parts", name, "manifest.json"), "utf8")), ino = fs.readFileSync(path.join(ROOT, "parts", name, "src/main.ino"), "utf8");
  const t = [];
  for (let i = 0; i < 5; i++) { const r = await page.evaluate((a, b) => CC.compileLite(a, b), ino + `\n// edit ${i}\n`, manifest); t.push({ total: ms(r.ms.total), cc: ms(r.ms.cc), ld: ms(r.ms.ld) }); }
  R.recompile = t; say("recompile of blink-echo, 5 runs (ms): " + t.map((x) => `${x.total} (cc ${x.cc} + ld ${x.ld})`).join(", "));
}
R.rssAfterCompiles = rssOf(profile); R.heapAfter = await page.evaluate(() => CC.memory());
say(`memory: Chrome RSS (all processes of the profile) ${(rss0 / 1e6).toFixed(0)} MB before, ${(R.rssAfterLoad / 1e6).toFixed(0)} MB after toolchain load, ${(R.rssAfterCompiles / 1e6).toFixed(0)} MB after compiles; measureUserAgentSpecificMemory ${((mem0 ?? 0) / 1e6).toFixed(0)} -> ${((R.heapAfter ?? 0) / 1e6).toFixed(0)} MB`);

// ---- what errors look like ----
{
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "parts", PARTS[0], "manifest.json"), "utf8"));
  const bad = `void setup() {\n  pinMode(2, OUTPUT)\n  Serial.begin(115200);\n}\nvoid loop() {\n  digitalWrite(2, HIGH);\n  delayy(500);\n  int x = "text";\n}\n`;
  const r = await page.evaluate((a, b) => CC.compileLite(a, b), bad, manifest);
  R.errorExample = { diagnostics: r.diagnostics, stderr: r.stderr, ms: r.ms };
  say("\nerror example (sketch lines: 2 missing ';', 7 typo, 8 type error):\n" + r.stderr);
  check("diagnostics carry the sketch's own line numbers", r.diagnostics.some((d) => d.file === "main.ino" && d.line === 2) && r.diagnostics.some((d) => d.line === 7));
  const ld = await page.evaluate((a, b) => CC.compileLite(a, b), `#include <FreeRTOS.h>\nvoid setup() {}\nvoid loop() {}\n`, manifest);
  R.missingHeader = ld.stderr; say("missing header: " + ld.stderr.split("\n")[0]);
  const ld2 = await page.evaluate((a, b) => CC.compileLite(a, b), `extern "C" void xTaskCreate(void*,void*,int);\nvoid setup() { xTaskCreate(0,0,0); }\nvoid loop() {}\n`, manifest);
  R.linkError = ld2.stderr; say("link error: " + (ld2.stderr.split("\n").filter(Boolean)[0] ?? "(none)") + "  ok=" + ld2.ok);
}

// ---- offline: stop the server, start a new compiler Worker: everything must come from the Cache API ----
S.close(); await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => CC.stop());
const reqBefore = S.stats.requests.length;
const warm = await page.evaluate(() => CC.start()).catch((e) => ({ error: String(e) }));
if (warm.error) check("offline restart of the toolchain", false, warm.error);
else {
  R.offlineStart = { wall_ms: ms(warm.wall), ms: warm.ms, assetMs: warm.stats.ms, fetched: warm.stats.fetched, fromCache: Object.keys(warm.stats.fromCache) };
  check("offline restart: no asset fetched, all from the Cache API", Object.keys(warm.stats.fetched).length === 0 && Object.keys(warm.stats.fromCache).length === 6, `${ms(warm.wall)} ms (assets ${ms(warm.ms.assets)}, first run ${ms(warm.ms.firstRun)})`);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "parts", PARTS[1], "manifest.json"), "utf8")), ino = fs.readFileSync(path.join(ROOT, "parts", PARTS[1], "src/main.ino"), "utf8");
  const r = await page.evaluate((a, b) => CC.compileLite(a, b), ino, manifest);
  check("offline compile works with the server down", r.ok, `${ms(r.ms.total)} ms`); R.offlineCompile = r.ms;
}
// ---- the page's own CSP vs a service worker (offline shell would need one) ----
{
  // the server is down; the registration is refused by CSP before any fetch
  const sw = await page.evaluate(async () => { try { await navigator.serviceWorker.register("/sw.js"); return "registered"; } catch (e) { return String(e); } });
  R.serviceWorker = sw; say("service worker under the site's CSP: " + sw);
}
check("no page error", errors.length === 0, errors.join(" | "));
R.csp = csp; R.outside = outside;
check("no request outside the test origin", outside.length === 0, outside.join(" "));
say("CSP console messages (expected: only the service worker one): " + JSON.stringify(csp));
fs.writeFileSync(path.join(HERE, "build/results-browser.json"), JSON.stringify(R, null, 1));
await browser.close(); fs.rmSync(profile, { recursive: true, force: true });
say(failed ? "\nBROWSER DEMO: FAILED" : "\nBROWSER DEMO: PASSED"); process.exit(failed ? 1 : 0);
