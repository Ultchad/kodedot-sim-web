// Headless Chrome: the parts on the real page conditions. Cross-origin isolation (COOP/COEP), a strict CSP (worker-src blob:), no network
// beyond the test's own origin. A Dot app blinks an LED part and reads a button part; a Dot app talks to an ESP32 part whose sketch runs in a
// blob module Worker; an I2C sensor part answers the Dot. Needs the packages parts_io, parts_i2c, parts_uart (tests/node/parts/ builds them).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { startPartsServer } from "./parts/server.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ["puppeteer-core", path.join(here, "../../web/node_modules/puppeteer-core"), "/home/claude/dotbench/web/node_modules/puppeteer-core"]) { try { puppeteer = require(p); break; } catch {} }
if (!puppeteer) throw new Error("puppeteer-core not found");
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { srv, url } = await startPartsServer(0);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [], outside = [], csp = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
page.on("request", (r) => { const u = r.url(); if (!u.startsWith(url) && !u.startsWith("blob:") && !u.startsWith("data:")) outside.push(u); });
const until = async (fn, ms, what) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 50 }); } catch { throw new Error("timeout waiting for " + what + "\n" + (await page.evaluate(() => P.text().slice(-1500)).catch(() => ""))); } };

await page.goto(url + "/");
await page.waitForFunction("window.PREADY === true", { timeout: 20000 });
await check("the page is cross-origin isolated and has SharedArrayBuffer", async () => {
  assert.equal(await page.evaluate(() => crossOriginIsolated), true);
  assert.equal(await page.evaluate(() => typeof SharedArrayBuffer), "function");
});

await check("parts_io: the Dot blinks an LED part and reads a button part (declarative parts, strict CSP)", async () => {
  await page.evaluate(async () => {
    await P.setup("parts_io", ["dotbench.led", "dotbench.push-button"]);
    const b = P.bench, led = b.addPart("dotbench.led"), btn = b.addPart("dotbench.push-button");
    for (const [x, y] of [["device.EXP4", led + ".A"], ["device.GND", led + ".K"], ["device.V33", btn + ".A"], ["device.EXP6", btn + ".B"]]) b.connect(x, y);
    P.led = led; P.btn = btn;
    await P.start();
  });
  await until(() => /parts_io up/.test(P.text()), 40000, "the app up");
  const seen = new Set();
  for (let i = 0; i < 80 && seen.size < 2; i++) { seen.add(await page.evaluate(() => P.bench.state().parts.find((p) => p.instance === P.led).outputs.brightness > 0.1 ? "on" : "off")); await sleep(50); }
  assert.deepEqual([...seen].sort(), ["off", "on"], "the LED part is lit and dark in turn");
  await page.evaluate(() => P.bench.setField(P.btn, "pressed", true));
  await until(() => /button down/.test(P.text()), 8000, "button down");
  await page.evaluate(() => P.bench.setField(P.btn, "pressed", false));
  await until(() => /button up/.test(P.text()), 8000, "button up");
});

await check("parts_i2c: the HDC1080 sensor part answers the Dot", async () => {
  await page.evaluate(async () => {
    await P.setup("parts_i2c", ["dotbench.hdc1080"]);
    const b = P.bench, s = b.addPart("dotbench.hdc1080");
    for (const [x, y] of [["device.EXP4", s + ".SDA"], ["device.EXP5", s + ".SCL"], ["device.V33", s + ".VCC"], ["device.GND", s + ".GND"]]) b.connect(x, y);
    P.s = s; await P.start();
  });
  await until(() => /probe 0x40 yes/.test(P.text()) && /manufacturer 0x5449/.test(P.text()) && /temp raw=0x6285 23\.49 C/.test(P.text()), 40000, "the readings");
});

await check("parts_uart: the Dot and an ESP32 part running a real sketch in a blob Worker exchange UART", async () => {
  await page.evaluate(async () => {
    await P.setup("parts_uart", ["dotbench.esp32-blink-echo"]);
    const b = P.bench, e = b.addPart("dotbench.esp32-blink-echo");
    for (const [x, y] of [["device.V33", e + ".V33"], ["device.GND", e + ".GND"], ["device.EXP9", e + ".RX"], ["device.EXP10", e + ".TX"]]) b.connect(x, y);
    P.e = e; await P.start();
  });
  await until(() => /reply \d+: ping \d+/.test(P.text()), 60000, "an echoed reply");
  const st = await page.evaluate(() => P.bench.state().parts.find((p) => p.instance === P.e));
  assert.ok(st.outputs.echoed > 0 && st.power.on && !st.crashed, JSON.stringify(st.outputs));
  assert.ok(st.console.some((l) => /echoing UART1/.test(l)), "the sketch's console: " + JSON.stringify(st.console));
});

await check("no page error, no CSP violation, no request beyond the test origin", async () => {
  assert.deepEqual(errors, []);
  assert.deepEqual(csp, []);
  assert.deepEqual(outside, []);
});

await browser.close(); srv.close();
console.log(failed ? "parts browser test: FAILED" : "parts browser test: PASSED");
process.exit(failed ? 1 : 0);
