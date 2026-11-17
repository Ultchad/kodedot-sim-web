// SPDX-License-Identifier: GPL-3.0-or-later
// Headless Chrome test of the in-browser compile service under the PRODUCTION conditions: COOP/COEP, the strict CSP of web/vercel.json
// (worker-src blob:, connect-src 'self'), assets compressed like Vercel's CDN, no request beyond the test origin.
// Chrome only: Firefox and Safari are NOT tested here. Needs: the asset build (node runtime/cc/build/build-assets.mjs) and the parts_uart app
// (tests/node/parts/run.sh builds it). usage: node tests/browser/cc.test.mjs
import assert from "node:assert/strict"; import { createRequire } from "node:module"; import path from "node:path"; import fs from "node:fs"; import os from "node:os";
import { startCcServer, assetsDir } from "./cc/server.mjs";
const here = path.dirname(new URL(import.meta.url).pathname), require = createRequire(import.meta.url);
let puppeteer;
for (const p of ["puppeteer-core", path.join(here, "../../web/node_modules/puppeteer-core"), "/home/claude/dotbench/web/node_modules/puppeteer-core"]) { try { puppeteer = require(p); break; } catch {} }
if (!puppeteer) throw new Error("puppeteer-core not found");
if (!fs.existsSync(path.join(assetsDir(), "manifest.json"))) { console.error("no compiler assets; run: node runtime/cc/build/build-assets.mjs"); process.exit(2); }
const B = JSON.parse(fs.readFileSync(path.join(here, "../node/cc/budgets.json"), "utf8"));
let failed = false; const R = {};
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { srv, stats, url } = await startCcServer(0);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cctest-"));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox", "--user-data-dir=" + profile] });
const page = await browser.newPage();
const errors = [], outside = [], csp = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
page.on("request", (r) => { const u = r.url(); if (!u.startsWith(url) && !u.startsWith("blob:") && !u.startsWith("data:")) outside.push(u); });
const until = async (fn, ms, what) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 100 }); } catch { throw new Error("timeout waiting for " + what + "\n" + (await page.evaluate(() => (window.P?.text?.() ?? "").slice(-400)))); } };
const build = (board, files, options) => page.evaluate((b, f, o) => P.build(b, f, o), board, files, options);
console.log(`machine: ${os.cpus().length} cpus, load ${os.loadavg().map((x) => x.toFixed(2)).join(" ")}; ${await browser.version()}`);

await page.goto(url + "/"); await page.waitForFunction("window.PREADY === true", { timeout: 30000 });
await check("the page is cross-origin isolated with the production CSP", async () => { assert.equal(await page.evaluate(() => crossOriginIsolated), true); });

await check("info() downloads only the manifest and tells the page boards, sizes and what is cached", async () => {
  stats.cc.length = 0;
  const info = await page.evaluate(async () => { const i = await P.newCompiler().info(); return { boards: Object.keys(i.boards), ready: i.ready, tc: i.download.toolchainBytes, missing: i.download.toolchainMissingBytes, sketch: i.boards.esp32.defaultSketch.text.length }; });
  assert.deepEqual(stats.cc, ["manifest.json"]);
  assert.equal(info.boards.length, 5); assert.equal(info.ready, false); assert.equal(info.missing, info.tc); assert.ok(info.sketch > 50);
  R.toolchainRawBytes = info.tc; assert.ok(info.tc <= B.toolchainRawBytes, `toolchain ${info.tc} B > ${B.toolchainRawBytes}`);
});

await check("cold start: byte progress is monotonic and complete, nothing is fetched twice, the Worker runs from a blob", async () => {
  stats.cc.length = 0; stats.ccBytes = 0;
  const t = Date.now();
  const r = await page.evaluate(async () => { const r = await P.cc.ready({ board: "esp32" }); const ev = P.progress.filter((e) => e.phase === "download"); return { r, n: ev.length, last: ev.at(-1), mono: ev.every((e, i) => i === 0 || e.overallLoaded >= ev[i - 1].overallLoaded), cached: ev.some((e) => e.cached) }; });
  R.coldReadyMs = Date.now() - t; R.coldTransferBytes = stats.ccBytes;
  assert.ok(r.n > 10 && r.mono && r.last.overallLoaded === r.last.overallTotal, JSON.stringify(r.last));
  assert.equal(new Set(stats.cc).size, stats.cc.length, "a file was requested twice: " + stats.cc.join(","));
  assert.ok(stats.cc.filter((n) => /^llvm\.core\.\w+\.\d+\.wasm$/.test(n)).length === 4, "four wasm chunks");
  assert.ok(!stats.cc.some((n) => n.startsWith("pch-stl")), "the STL PCH must not be fetched for a plain board");
  console.log(`       cold ready ${R.coldReadyMs} ms, ${stats.ccBytes} bytes over the wire (brotli q4 like a CDN), ${stats.cc.length} requests`);
  assert.ok(R.coldReadyMs <= B.readyMs * 3, "cold ready too slow");
});

await check("compile: default sketch of every board, in the Worker", async () => {
  const infos = await page.evaluate(async () => { const i = await P.cc.info(); return Object.fromEntries(Object.entries(i.boards).map(([k, b]) => [k, b.defaultSketch.text])); });
  for (const [id, text] of Object.entries(infos)) {
    const r = await build(id, { "main.ino": text }); assert.ok(r.ok, id + ": " + JSON.stringify(r.diagnostics));
    if (id === "esp32") { R.trivialMs = r.timings.totalMs; assert.ok(r.timings.totalMs <= B.trivialCompileMs * 2, "trivial compile " + r.timings.totalMs); assert.ok(r.bytes <= B.wasmBytesTrivial); }
  }
});

await check("diagnostics reach the page structured, mapped to the user's lines", async () => {
  const r = await build("esp32", { "main.ino": "void setup(){\n  int x = ;\n}\nvoid loop(){}\n" });
  assert.ok(!r.ok && r.diagnostics[0].file === "main.ino" && r.diagnostics[0].line === 2 && r.diagnostics[0].severity === "error", JSON.stringify(r.diagnostics));
});

await check("String + Servo + Wire sketch builds; an STL sketch fetches the STL PCH lazily", async () => {
  let r = await build("esp32", { "main.ino": "#include <Servo.h>\n#include <Wire.h>\nServo s;\nvoid setup(){ Serial.begin(115200); String a=\"x\"; a += String(3.5f,2); Serial.println(a); s.attach(4); Wire.begin(21,22); }\nvoid loop(){}\n" });
  assert.ok(r.ok, JSON.stringify(r.diagnostics));
  stats.cc.length = 0;
  r = await build("esp32", { "main.ino": "#include <vector>\nvoid setup(){ std::vector<int> v{1,2}; Serial.println((int)v.size()); }\nvoid loop(){}\n" });
  assert.ok(r.ok && r.pch === "stl", JSON.stringify(r)); assert.ok(stats.cc.some((n) => n.startsWith("pch-stl-esp32")), "STL PCH fetched on demand: " + stats.cc.join(","));
  R.stlMs = r.timings.totalMs;
});

await check("cancel: the running compile and a queued one resolve as cancelled, the next compile works", async () => {
  const r = await page.evaluate(async () => {
    const a = P.cc.compile({ board: "esp32", files: { "main.ino": "#include <vector>\nvoid setup(){}\nvoid loop(){}\n// c1\n" } });
    const b = P.cc.compile({ board: "esp32", files: { "main.ino": "void setup(){}\nvoid loop(){}\n// c2\n" } });
    await new Promise((x) => setTimeout(x, 200)); P.cc.cancel();
    const [ra, rb] = await Promise.all([a, b]);
    return { a: ra.cancelled, b: rb.cancelled };
  });
  assert.deepEqual(r, { a: true, b: true });
  const ok = await build("esp32", { "main.ino": "void setup(){}\nvoid loop(){}\n// after\n" }); assert.ok(ok.ok, JSON.stringify(ok.diagnostics));
});

await check("persistent cache: after a reload with the network to /cc/ blocked, the compiler still starts and compiles (manifest and files from the Cache API)", async () => {
  await page.setRequestInterception(true);
  let blocked = 0;
  const h = (req) => { if (new URL(req.url()).pathname.startsWith("/cc/")) { blocked++; req.abort("internetdisconnected"); } else req.continue(); };
  page.on("request", h);
  stats.cc.length = 0;
  await page.reload(); await page.waitForFunction("window.PREADY === true", { timeout: 30000 });
  const t = Date.now();
  const r = await page.evaluate(async () => {
    const cc = P.newCompiler(); const info = await cc.info(); const rd = await cc.ready({ board: "esp32" });
    const out = await P.build("esp32", { "main.ino": "void setup(){ Serial.begin(115200); Serial.println(\"offline\"); }\nvoid loop(){}\n" });
    return { infoReady: info.ready, fromCacheManifest: info.manifestFromCache, ok: out.ok, fromCache: rd.fromCache, fromNetwork: rd.fromNetwork };
  });
  R.reloadReadyMs = Date.now() - t;
  page.off("request", h); await page.setRequestInterception(false);
  assert.ok(r.infoReady && r.fromCacheManifest && r.ok, JSON.stringify(r));
  assert.equal(r.fromNetwork, 0); assert.ok(r.fromCache > 50e6, "read from cache: " + r.fromCache);
  assert.equal(stats.cc.length, 0, "the server saw /cc/ requests: " + stats.cc.join(","));
  assert.ok(blocked >= 1, "the manifest request must have been attempted and blocked");
  console.log(`       reload, offline: ready + compile in ${R.reloadReadyMs} ms, ${blocked} blocked requests, ${r.fromCache} bytes from the cache`);
});

await check("edit, compile, upload to a running bench: the board restarts with the new code; the Dot and the other board keep running; the serial monitor streams", async () => {
  await page.evaluate(async () => {
    await P.setup("parts_uart", ["dotbench.esp32-blink-echo", "dotbench.uno-r4-minima"]);
    const b = P.bench, e = b.addPart("dotbench.esp32-blink-echo"), u = b.addPart("dotbench.uno-r4-minima");
    for (const [x, y] of [["device.V33", e + ".V33"], ["device.GND", e + ".GND"], ["device.EXP9", e + ".RX"], ["device.EXP10", e + ".TX"]]) b.connect(x, y);
    P.e = e; P.u = u; P.events = []; b.on?.("part", (ev) => P.events.push(ev)); await P.start();
  });
  await until(() => /reply \d+: ping \d+/.test(P.text()), 60000, "the Dot to get echoed replies from the original sketch");
  await until(() => P.bench.serialLog(P.u).length >= 2, 30000, "the second board's serial monitor");
  const before = await page.evaluate(() => ({ dot: P.text().split("\n").length, e: P.bench.serialLog(P.e), u: P.bench.serialLog(P.u).length, t: P.bench.state().t }));
  const v2 = `#include <dotbench.h>\nvoid setup(){ Serial.begin(115200); Serial1.begin(115200, SERIAL_8N1, 16, 17); Serial.println("v2 booted, millis=" + String(millis())); }\nvoid loop(){ while (Serial1.available()) { int c = Serial1.read(); Serial1.write((uint8_t)toupper(c)); } delay(1); }\n`;
  const up = await page.evaluate((src) => P.upload(P.e, "esp32", { "main.ino": src }), v2);
  assert.ok(up.ok, JSON.stringify(up)); R.uploadCompileMs = up.timings.totalMs;
  await until(() => P.bench.serialLog(P.e).some((l) => /v2 booted/.test(l)), 30000, "the new sketch's greeting on the serial monitor");
  await until(() => /reply \d+: PING \d+/.test(P.text()), 60000, "the Dot to get UPPERCASE replies: the new code is what answers");
  const after = await page.evaluate(() => ({ text: P.text(), e: P.bench.serialLog(P.e), u: P.bench.serialLog(P.u), code: P.bench.getPartCode(P.e).custom, state: P.bench.state().parts.map((p) => ({ i: p.instance, crashed: p.crashed, on: p.power.on })) }));
  assert.ok(after.code, "getPartCode reports custom code");
  assert.ok(!after.e.some((l) => /echoing UART1/.test(l)), "the old sketch's console is gone: this part restarted");
  assert.ok(after.text.split("\n").length > before.dot, "the Dot kept logging");
  assert.equal((after.text.match(/reply 1: /g) ?? []).length, 1, "the Dot's counter never restarted (the Dot was not rebooted)");
  assert.ok(after.u.length >= before.u && after.u[0] === (await page.evaluate(() => P.bench.serialLog(P.u)[0])), "the other board kept its console");
  assert.ok(after.state.every((p) => p.on && !p.crashed), JSON.stringify(after.state));
  console.log(`       upload: compile ${R.uploadCompileMs} ms; part events ${await page.evaluate(() => P.events.map((e) => e.type).join(","))}`);
});

await check("no page error, no CSP violation, no request beyond the test origin", async () => { assert.deepEqual(errors, []); assert.deepEqual(csp, []); assert.deepEqual(outside, []); });
console.log("measured:", JSON.stringify(R));
await browser.close(); srv.close();
console.log(failed ? "cc browser test: FAILED" : "cc browser test: PASSED");
process.exit(failed ? 1 : 0);
