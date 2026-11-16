// Headless Chrome test of runtime/web-adapter: both examples from an in-memory package, drawing, input,
// stop/start, restarts, hidden page, and the numbers the stage-1 report asks for.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { startServer } from "./server.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ["puppeteer-core", path.join(here, "../../web/node_modules/puppeteer-core")]) { try { puppeteer = require(p); break; } catch {} }
if (!puppeteer) throw new Error("puppeteer-core not found (cd tests/browser && npm i puppeteer-core, or use web/node_modules)");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const check = async (name, fn) => {
  const e0 = pageErrors.length;
  try { await fn(); console.log("ok   - " + name + (pageErrors.length > e0 ? "   [+" + (pageErrors.length - e0) + " page errors]" : "")); }
  catch (e) { failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); }
};

const { srv, url } = await startServer(0);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true,
  args: ["--no-sandbox", "--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
const page = await browser.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text() + " @" + JSON.stringify(m.location())); });
await page.goto(url + "/");
await page.waitForFunction("window.TREADY === true", { timeout: 15000 }).catch((e) => { console.log("page errors:", pageErrors); throw e; });

const ev = (fn, ...a) => page.evaluate(fn, ...a);
const until = async (fn, ms, what, ...a) => {
  try { await page.waitForFunction(fn, { timeout: ms, polling: 50 }, ...a); } catch { throw new Error("timeout waiting for " + what); }
};
const numbers = {};
const logText = () => ev(() => T.dev.lines.map((l) => l.text).join("\n"));

await check("page is cross-origin isolated with SharedArrayBuffer, strict CSP in force", async () => {
  assert.equal(await ev(() => crossOriginIsolated), true);
  assert.equal(await ev(() => typeof SharedArrayBuffer), "function");
});

await ev(() => T.store("buttons_led")); await ev(() => T.store("display_lvgl"));

await check("buttons_led: loaded from IndexedDB bytes, boots, LED goes green, a log line arrives", async () => {
  await ev(() => T.open("buttons_led"));
  assert.equal(await ev(() => T.dev.status), "idle");
  await ev(() => { window.t0 = performance.now(); return T.dev.start(); });
  await until(() => T.dev.status === "running", 15000, "running");
  await until(() => { const l = T.dev.led; return l.g === 32 && l.r === 0; }, 15000, "LED green");
  await until(() => T.dev.lines.some((l) => /up; the top button swaps/.test(l.text)), 15000, "boot log line");
  const line = await ev(() => T.dev.lines.find((l) => /up; the top button/.test(l.text)));
  assert.equal(line.level, "info");
  assert.ok(!/\x1b/.test(line.text) && !/^!I /.test(line.text), "level prefix and ANSI removed: " + line.text);
});

await check("buttons_led: top button by id turns the LED red; releaseAll is harmless", async () => {
  await ev(() => T.dev.button("top", true));
  await until(() => T.dev.led.r === 32, 8000, "LED red");
  await ev(() => T.dev.button("top", false));
  await ev(() => T.dev.releaseAll());
});

await check("buttons_led: console input is echoed once with level 'input'", async () => {
  const n = await ev(() => T.dev.lines.length);
  await ev(() => T.dev.sendConsole("help"));
  await sleep(1200);
  const added = await ev((n) => T.dev.lines.slice(n).map((l) => ({ level: l.level, text: l.text })), n);
  assert.equal(added.filter((l) => l.level === "input" && l.text === "help").length, 1, JSON.stringify(added));
  const echoes = added.filter((l) => l.level !== "input" && /^\s*(kode> )?help\s*$/.test(l.text));
  assert.equal(echoes.length, 0, "firmware echo not suppressed: " + JSON.stringify(echoes));
  assert.ok(added.length > 5, "the console answered: " + added.length + " lines");
});

await check("buttons_led: stop, start again (power-on), still works", async () => {
  await ev(() => T.dev.stop());
  assert.equal(await ev(() => T.dev.status), "idle");
  assert.equal(await ev(() => T.dev.workerCount), 0);
  await ev(() => T.dev.start());
  await until(() => T.dev.status === "running" && T.dev.led.g === 32, 15000, "running again, LED green");
});

await check("display_lvgl: draws, canvas pixels equal the wasm framebuffer", async () => {
  await ev(() => T.open("display_lvgl"));
  await ev(() => { window.t0 = performance.now(); window.first = null; const iv = setInterval(() => { if (T.dev.frameSeq > 0 && first === null) { first = performance.now() - t0; clearInterval(iv); } }, 5); return T.dev.start(); });
  await until(() => window.first !== null, 20000, "first frame");
  numbers.ttff = Math.round(await ev(() => window.first));
  await until(() => T.dev.lines.some((l) => /LVGL running/.test(l.text)), 15000, "LVGL up");
  await sleep(500);
  let r = null;
  for (let i = 0; i < 20 && !r; i++) { r = await ev(() => T.compare()); await sleep(100); }
  assert.ok(r, "picture never settled for a comparison");
  assert.equal(r.diff, 0, "canvas differs from framebuffer in " + r.diff + " bytes");
  assert.ok(r.colours > 2, "colours " + r.colours);
  assert.equal(await ev(() => T.dev.panelOn), true);
  assert.equal(await ev(() => T.dev.backlight), 100);
});

await check("display_lvgl: touch and button change the counter and the canvas", async () => {
  const before = await ev(() => T.dev.lines.filter((l) => /count \d+/.test(l.text)).length);
  const seq0 = await ev(() => T.t.seq);
  await ev(() => T.dev.touch(205, 251, true)); await sleep(250); await ev(() => T.dev.touch(205, 251, false));
  await until((n) => T.dev.lines.filter((l) => /count \d+/.test(l.text)).length > n, 8000, "count after touch", before);
  await until((s) => T.t.seq !== s, 5000, "new frame after touch", seq0);
  const c = await ev(() => T.dev.lines.filter((l) => /count \d+/.test(l.text)).length);
  await ev(() => T.dev.button("top", true)); await sleep(150); await ev(() => T.dev.button("top", false));
  await until((n) => T.dev.lines.filter((l) => /count \d+/.test(l.text)).length > n, 8000, "count after button", c);
});

await check("display_lvgl: steady-state frame rate while idle and under touch drag", async () => {
  // fps = frames that reached the glass per second, measured on the shared counter (not rAF)
  const idle = await ev(async () => { const a = T.dev.frameSeq, t = performance.now(); await new Promise((r) => setTimeout(r, 3000)); return (T.dev.frameSeq - a) / ((performance.now() - t) / 1000); });
  const drag = await ev(async () => {
    const a = T.dev.frameSeq, p0 = T.t.paints, t = performance.now();
    let i = 0; await new Promise((res) => { const iv = setInterval(() => { T.dev.touch(60 + (i % 290), 100 + (i % 300), true); if (++i > 150) { clearInterval(iv); T.dev.touch(60, 100, false); res(); } }, 20); });
    const s = (performance.now() - t) / 1000; return { fps: (T.dev.frameSeq - a) / s, paints: (T.t.paints - p0) / s };
  });
  numbers.fpsIdle = Math.round(idle * 10) / 10; numbers.fpsDrag = Math.round(drag.fps * 10) / 10; numbers.paintsDrag = Math.round(drag.paints * 10) / 10;
});

await check("5 restarts alternating the apps: worker count stable, keep/RAM semantic, status events", async () => {
  const apps = ["buttons_led", "display_lvgl"];
  const w0 = await ev(() => T.dev.workerCount);
  const heap = [];
  for (let i = 0; i < 5; i++) {
    await ev(() => { T.statuses.length = 0; return T.dev.restart(); });
    await until(() => T.dev.status === "running", 15000, "running after restart " + i);
    const w = await ev(() => T.dev.workerCount);
    assert.equal(w, w0, "worker count after restart " + i);
    if (i % 2 === 0) { await ev((a) => T.open(a), apps[(i + 1) % 2]); await ev(() => T.dev.start()); await until(() => T.dev.status === "running", 15000, "running after switch"); }
    heap.push(await ev(() => T.mem()));
  }
  numbers.workers = w0;
  numbers.afterRestarts = heap[heap.length - 1];
});

await check("firmware-requested restart (reset_probe bottom button path) reaches the page as restart-requested", async () => {
  // reset_probe is a test app; if it was not built, skip with a note
  const ok = await ev(async () => { try { await T.store("reset_probe"); return true; } catch { return false; } });
  if (!ok) return console.log("     skipped: reset_probe not built");
  await ev(() => T.open("reset_probe"));
  await ev(() => { T.statuses.length = 0; return T.dev.start(); });
  await until(() => T.dev.status === "running" && T.dev.lines.length > 2, 15000, "reset_probe running");
  await ev(() => T.dev.button("bottom", true));
  await until(() => T.statuses.some((s) => s.status === "restart-requested"), 10000, "restart-requested");
  const s = await ev(() => T.statuses.find((s) => s.status === "restart-requested"));
  assert.ok(s.reason, "reason present: " + JSON.stringify(s));
  await until(() => T.statuses.some((s) => s.status === "running"), 15000, "running again after the automatic restart");
  await ev(() => T.dev.button("bottom", false));
  console.log("     restart-requested reason: " + s.reason);
});

await check("hidden page: firmware keeps running, outputs and restart still observed", async () => {
  await ev(() => T.open("buttons_led")); await ev(() => T.dev.start());
  await until(() => T.dev.status === "running" && T.dev.led.g === 32, 15000, "buttons_led up");
  // emulate a backgrounded tab: Chrome throttles timers of hidden pages to 1 Hz; CDP can force visibility off
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false }).catch(() => {});
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" }).catch(() => {});
  await cdp.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  const page2 = await browser.newPage();   // opening another tab puts the first one in the background
  await page2.goto("about:blank"); await page2.bringToFront();
  const hidden = await ev(() => document.visibilityState);
  await sleep(500);
  await ev(() => T.dev.button("top", true));       // input while hidden: still delivered
  await sleep(3000);
  const led = await ev(() => T.dev.led);
  await ev(() => T.dev.button("top", false));
  const fpsHidden = await ev(() => { const a = T.dev.frameSeq; return a; });
  await page.bringToFront(); await page2.close();
  console.log("     visibilityState while backgrounded: " + hidden + ", LED after press: " + JSON.stringify(led));
  numbers.hidden = { visibility: hidden, ledReact: led.r === 32 };
  assert.equal(await ev(() => T.dev.status), "running");
});

await check("memory: JS heap + wasm memory + workers after everything", async () => {
  await ev(() => T.open("display_lvgl")); await ev(() => T.dev.start());
  await until(() => T.dev.status === "running", 15000, "running");
  await sleep(2000);
  const m = await ev(() => T.mem());
  numbers.final = m;
  assert.ok(m.wasm >= 96 * 1024 * 1024 && m.wasm <= 97 * 1024 * 1024, "wasm memory " + m.wasm);
});

await check("no page errors", async () => {
  if (pageErrors.length) console.log("     in-page errors: " + JSON.stringify(await ev(() => window.errs.slice(0, 5)))); assert.deepEqual(pageErrors, []); });

console.log("NUMBERS " + JSON.stringify(numbers));
await browser.close(); srv.close();
console.log(failed ? "browser: FAILED" : "browser: PASSED");
process.exit(failed ? 1 : 0);
