// Headless Chrome demo + measurements. The page is served with the production COOP/COEP/CSP headers; the toolchain runs in a blob Worker;
// the compiled sketch becomes a .dotpart and runs on the real part runtime (the same scenario files as the offline-built parts).
// Usage: NODE_PATH=/home/claude/dotbench/web/node_modules node demo-browser.mjs        (needs 01-fetch.sh and 02-prepare.mjs first)
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { execSync } from "node:child_process"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
import { startServer } from "./server.mjs";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");
const PARTS = ["esp32-blink-echo", "esp32-i2c-slave", "esp32-button-led"];
const R = { when: new Date().toISOString(), load: os.loadavg(), cpus: os.cpus().length, cpuModel: os.cpus()[0].model }; let failed = false;
const say = (s) => console.log(s); const ms = (x) => Math.round(x);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const procs = (tag) => { try { return execSync(`ps -eo rss,args | grep -- '${tag}' | grep -v grep`).toString().trim().split("\n").map((l) => { const m = /^\s*(\d+)\s+(.*)$/.exec(l); return { rss: +m[1] * 1024, renderer: /--type=renderer/.test(m[2]) }; }); } catch { return []; } };
const rss = (tag) => { const p = procs(tag); return { all: p.reduce((n, x) => n + x.rss, 0), renderers: p.filter((x) => x.renderer).reduce((n, x) => n + x.rss, 0) }; };
const MB = (n) => (n / 1e6).toFixed(0) + " MB";

const S = await startServer({ compress: "br" });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ccprof-"));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--user-data-dir=" + profile] });
R.chrome = await browser.version();
const page = await browser.newPage();
const errors = [], csp = [], outside = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { const t = m.text(); if (/Content Security Policy|Refused to/i.test(t)) csp.push(t); if (process.env.VERBOSE) say("[page] " + t); });
page.on("request", (r) => { const u = r.url(); if (!u.startsWith(S.url) && !u.startsWith("blob:") && !u.startsWith("data:")) outside.push(u); });
const check = (name, ok, extra = "") => { if (!ok) failed = true; say(`${ok ? "ok  " : "FAIL"} - ${name}${extra ? "  " + extra : ""}`); };
const manifestOf = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, "parts", n, "manifest.json"), "utf8"));
const inoOf = (n) => fs.readFileSync(path.join(ROOT, "parts", n, "src/main.ino"), "utf8");
const compile = (ino, manifest, board = null) => page.evaluate((a, b, c) => CC.compileLite(a, b, c), ino, manifest, board);
say(`machine: ${R.cpus} cpus (${R.cpuModel}), load average at start ${R.load.map((x) => x.toFixed(2)).join(" ")}; ${R.chrome}`);

await page.goto(S.url + "/"); await page.waitForFunction("window.READY === true", { timeout: 30000 });
check("page is cross-origin isolated (COOP/COEP) with the production CSP", await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer === "function"));
const rss0 = rss(profile);

// ---- A. cold start: empty profile, empty Cache API ----
const bytes0 = S.stats.bytes;
const cold = await page.evaluate(() => CC.start());
const first = await compile(inoOf(PARTS[0]), manifestOf(PARTS[0]));
R.cold = { start_ms: ms(cold.wall), init: cold.ms, assetMs: cold.stats.ms, fetched: cold.stats.fetched, transferBytes: S.stats.bytes - bytes0, firstCompile: first.ms, firstOk: first.ok };
say(`A. cold: toolchain ready ${ms(cold.wall)} ms (fetch+compile modules and unpack packs ${ms(cold.ms.assets)}, first no-op run ${ms(cold.ms.firstRun)}); first compile of blink-echo ${ms(first.ms.total)} ms (cc ${ms(first.ms.cc)} + link ${ms(first.ms.ld)}); ${((S.stats.bytes - bytes0) / 1e6).toFixed(2)} MB over the wire (brotli q5 from a loopback server)`);
say("   per asset: " + JSON.stringify(cold.stats.ms));
R.rssCold = rss(profile); R.rssBase = rss0;

// ---- B. the three example sketches, built in the page, run on the real runtime ----
R.sketches = {};
for (const name of PARTS) {
  const tests = []; for (const f of fs.readdirSync(path.join(ROOT, "parts", name, "tests")).filter((x) => x.endsWith(".test.json")).sort()) tests.push(JSON.parse(fs.readFileSync(path.join(ROOT, "parts", name, "tests", f), "utf8")));
  const r = await page.evaluate((n, t) => CC.build(n, t), name, tests);
  check(`B. ${name}: compiled in the worker, accepted by the importer`, r.ok, r.ok ? `cc ${ms(r.ms.cc)} + link ${ms(r.ms.ld)} = ${ms(r.ms.total)} ms, wasm ${r.wasm} B, .dotpart ${r.pkg} B` : JSON.stringify(r.importer ?? r.stderr));
  for (const s of r.scenarios ?? []) check(`B. ${name}: scenario "${s.name}" (${s.steps} steps)`, s.ok, s.ok ? "" : s.error);
  if (r.stderr?.trim()) say("  compiler output: " + r.stderr.trim());
  R.sketches[name] = { wasm: r.wasm, pkg: r.pkg, ms: r.ms, scenarios: r.scenarios?.map((s) => ({ name: s.name, ok: s.ok, steps: s.steps })) };
}

// ---- C. recompile timing, precompiled header on and off ----
R.recompile = {};
for (const pch of [true, false]) {
  await page.evaluate((v) => CC.config({ usePch: v }), pch);
  const t = [];
  for (let i = 0; i < 7; i++) { const r = await compile(inoOf(PARTS[0]) + `\n// edit ${pch} ${i}\n`, manifestOf(PARTS[0])); t.push({ total: ms(r.ms.total), cc: ms(r.ms.cc), ld: ms(r.ms.ld) }); }
  R.recompile[pch ? "pch" : "nopch"] = { runs: t, medianTotal: median(t.map((x) => x.total)), medianCc: median(t.map((x) => x.cc)), medianLd: median(t.map((x) => x.ld)) };
  say(`C. recompile, precompiled header ${pch ? "ON " : "OFF"}: median ${R.recompile[pch ? "pch" : "nopch"].medianTotal} ms (cc ${R.recompile[pch ? "pch" : "nopch"].medianCc} + link ${R.recompile[pch ? "pch" : "nopch"].medianLd}); runs ${t.map((x) => x.total).join(" ")}`);
}
await page.evaluate(() => CC.config({ usePch: true }));

// ---- D. sketch size scaling ----
R.scale = [];
for (const n of [50, 200, 800]) {
  let ino = "uint32_t acc = 0;\n"; for (let i = 0; i < n; i++) ino += `int work${i}(int x) {\n  String s = String(x) + "-${i}";\n  acc += s.length() * ${i + 1};\n  if (x % ${i + 2} == 0) { Serial.print(s); Serial.println(acc); }\n  return (int)(acc & 0xff);\n}\n`;
  ino += "void setup() { Serial.begin(115200); }\nvoid loop() {\n"; for (let i = 0; i < n; i++) ino += `  work${i}(millis() + ${i});\n`; ino += "  delay(100);\n}\n";
  const lines = ino.split("\n").length, r = await compile(ino, manifestOf(PARTS[0]));
  R.scale.push({ functions: n, lines, ok: r.ok, ms: r.ms, wasm: r.wasmBytes });
  say(`D. ${lines} lines (${n} functions): ${r.ok ? "ok" : "FAILED " + r.stderr.slice(0, 200)}  cc ${ms(r.ms.cc)} + link ${ms(r.ms.ld)} = ${ms(r.ms.total)} ms, wasm ${r.wasmBytes} B`);
}
R.rssAfter = rss(profile);
say(`E. memory (Chrome processes of this profile, RSS): before page ${MB(rss0.all)} (renderers ${MB(rss0.renderers)}); after toolchain load + first compile ${MB(R.rssCold.all)} (renderers ${MB(R.rssCold.renderers)}); after all compiles ${MB(R.rssAfter.all)} (renderers ${MB(R.rssAfter.renderers)})`);

// ---- F. what errors look like ----
{
  const m = manifestOf(PARTS[0]);
  const bad = `void setup() {\n  pinMode(2, OUTPUT)\n  Serial.begin(115200);\n}\nvoid loop() {\n  digitalWrite(2, HIGH);\n  delayy(500);\n  int x = "text";\n}\n`;
  const r = await compile(bad, m);
  R.errorExample = { diagnostics: r.diagnostics, stderr: r.stderr, ms: r.ms };
  say("F. error example (sketch lines: 2 missing ';', 7 typo, 8 type error):\n" + r.stderr.replace(/^/gm, "     "));
  check("F. diagnostics carry the sketch's own line numbers", r.diagnostics.some((d) => d.file === "main.ino" && d.line === 2) && r.diagnostics.some((d) => d.line === 7) && r.diagnostics.some((d) => d.line === 8), `${r.diagnostics.filter((d) => d.severity === "error").length} errors, ${ms(r.ms.total)} ms`);
  const ld2 = await compile(`extern "C" void xTaskCreate(void*,void*,int);\nvoid setup() { xTaskCreate(0,0,0); }\nvoid loop() {}\n`, m);
  R.linkError = ld2.stderr; say("   link error: " + (ld2.stderr.split("\n").filter(Boolean)[0] ?? "(none)") + "  ok=" + ld2.ok);
}

// ---- G. a returning visitor: the page is reloaded, the Cache API holds the toolchain, the server is still up (HTTP cache is off: no-store) ----
await page.reload(); await page.waitForFunction("window.READY === true", { timeout: 30000 });
{
  const reqBefore = S.stats.requests.filter((r) => r.startsWith("/cc/")).length, rssB = rss(profile);
  const warm = await page.evaluate(() => CC.start());
  const f = await compile(inoOf(PARTS[0]), manifestOf(PARTS[0]));
  R.returning = { start_ms: ms(warm.wall), init: warm.ms, assetMs: warm.stats.ms, fetched: warm.stats.fetched, fromCache: Object.keys(warm.stats.fromCache), firstCompile: f.ms, ccRequests: S.stats.requests.filter((r) => r.startsWith("/cc/")).length - reqBefore };
  check("G. returning visit: toolchain assets all from the Cache API, none from the network", Object.keys(warm.stats.fetched).length === 0 && Object.keys(warm.stats.fromCache).length === 8, `ready ${ms(warm.wall)} ms (assets ${ms(warm.ms.assets)}, first no-op run ${ms(warm.ms.firstRun)}); first compile ${ms(f.ms.total)} ms; asset ms ${JSON.stringify(warm.stats.ms)}`);
  R.rssReturning = rss(profile);
}

// ---- H. offline: stop the server, start a new compiler Worker: everything must come from the Cache API ----
S.close(); await new Promise((r) => setTimeout(r, 300));
await page.evaluate(() => CC.stop());
{
  const off = await page.evaluate(() => CC.start()).catch((e) => ({ error: String(e) }));
  if (off.error) check("H. offline restart of the toolchain", false, off.error);
  else {
    const r = await compile(inoOf(PARTS[1]), manifestOf(PARTS[1]));
    R.offline = { start_ms: ms(off.wall), fetched: off.stats.fetched, fromCache: Object.keys(off.stats.fromCache), compile: r.ms, ok: r.ok };
    check("H. offline (server stopped): toolchain starts and compiles", r.ok && Object.keys(off.stats.fetched).length === 0, `ready ${ms(off.wall)} ms, compile ${ms(r.ms.total)} ms`);
  }
}
// ---- I. the site's CSP vs a service worker (an offline page shell would need one) ----
R.serviceWorker = await page.evaluate(async () => { try { await navigator.serviceWorker.register("/sw.js"); return "registered"; } catch (e) { return String(e); } });
say("I. service worker under the site's CSP (worker-src blob: only): " + R.serviceWorker);
check("no page error", errors.length === 0, errors.join(" | "));
check("no request outside the test origin", outside.length === 0, outside.join(" "));
const cspOther = csp.filter((c) => !/sw\.js/.test(c)); check("no CSP violation except the service worker probe", cspOther.length === 0, JSON.stringify(cspOther));
R.csp = csp; R.outside = outside;
fs.mkdirSync(path.join(HERE, "build"), { recursive: true });
fs.writeFileSync(path.join(HERE, "build/results-browser.json"), JSON.stringify(R, null, 1));
await browser.close(); fs.rmSync(profile, { recursive: true, force: true });
say(failed ? "\nBROWSER DEMO: FAILED" : "\nBROWSER DEMO: PASSED"); process.exit(failed ? 1 : 0);
