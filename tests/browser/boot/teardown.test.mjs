// Headless Chrome: tearing a program down must never raise an uncaught error in the page. 20 launch/home cycles (apps alternate, the time in
// the app varies from "just started" to a second), then an install, a remove and a factory reset (all tear a program down).
// Any `pageerror` fails the test (the Emscripten ExitStatus of a torn-down program used to escape as an uncaught exception).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { startBootServer } from "./server.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ["puppeteer-core", path.join(here, "../../../web/node_modules/puppeteer-core"), "/home/claude/dotbench/web/node_modules/puppeteer-core"]) { try { puppeteer = require(p); break; } catch {} }
if (!puppeteer) throw new Error("puppeteer-core not found");
const CYCLES = +(process.env.TEARDOWN_CYCLES || 20);
const { srv, url } = await startBootServer(0);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.stack ?? e)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
const until = async (fn, ms, what) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 50 }); } catch { throw new Error("timeout waiting for " + what + "\n" + (await page.evaluate(() => B.text().slice(-1500)).catch(() => ""))); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
try {
  await page.goto(url + "/"); await page.evaluate(() => B.eraseDb());
  await page.goto(url + "/"); await page.waitForFunction("window.PREADY === true", { timeout: 15000 });
  await page.evaluate(() => B.open());
  await until(() => /kgui first frame/.test(B.text()), 120000, "kodeOS first frame");
  const delays = [0, 50, 200, 700, 1500];
  for (let i = 0; i < CYCLES; i++) {
    const project = i % 2 ? "display_lvgl" : "kody_kart";
    await page.evaluate((p) => S.launch(S.list().find((a) => a.project === p).id), project);
    await until(() => S.program?.kind === "app", 60000, "launch " + i);
    await sleep(delays[i % delays.length]);
    await page.evaluate(() => S.home());
    await until(() => S.program?.kind === "os" && S.status === "running", 60000, "home " + i);
  }
  await page.evaluate(() => B.install("crash_app"));
  await until(() => S.program?.kind === "os" && S.list().length === 4, 60000, "install");
  await page.evaluate(() => S.remove(S.list().find((a) => a.project === "crash_app").id));
  await until(() => S.program?.kind === "os" && S.list().length === 3, 60000, "remove");
  await page.evaluate(() => S.factoryReset());
  await until(() => S.program?.kind === "os" && S.status === "running" && S.list().length === 3, 90000, "factory reset");
  await sleep(1500);
  await page.evaluate(() => S.stop());
  await sleep(1000);
} catch (e) { failed = true; console.log("FAIL\n" + (e.stack ?? e)); }
try { assert.deepEqual(errors, [], "page errors during teardown"); console.log("ok   - " + CYCLES + " launch/home cycles, install, remove and factory reset: no page error"); }
catch (e) { failed = true; console.log("FAIL - " + e.message + "\n" + errors.join("\n---\n")); }
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
