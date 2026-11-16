// Headless Chrome: DotbenchSystem in a real page (blob: workers, IndexedDB, isolation headers): first boot seeds the factory apps,
// a launch goes to the app and home returns to kodeOS (FROM_APP), a run-time install and a delete survive a full reload.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { startBootServer } from "./server.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ["puppeteer-core", path.join(here, "../../../web/node_modules/puppeteer-core"), "/home/claude/dotbench/web/node_modules/puppeteer-core"]) { try { puppeteer = require(p); break; } catch {} }
if (!puppeteer) throw new Error("puppeteer-core not found");
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); } };
const shots = process.env.BOOT_SHOTS || path.join(here, "../../../docs/boot-shots");
const { srv, url } = await startBootServer(0);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const until = async (fn, ms, what) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 100 }); } catch { throw new Error("timeout waiting for " + what + "\n" + (await page.evaluate(() => B.text().slice(-1500)).catch(() => ""))); } };
const open = async () => { await page.goto(url + "/"); await page.waitForFunction("window.PREADY === true", { timeout: 15000 }); await page.evaluate(() => B.open()); await until(() => /kgui first frame/.test(B.text()), 120000, "kodeOS first frame"); };
const names = () => page.evaluate(() => S.list().map((a) => a.project));
const snap = async (file) => { const png = await page.evaluate(() => { const f = S.frame(); const c = document.createElement("canvas"); c.width = f.width; c.height = f.height; const x = c.getContext("2d"); const id = x.createImageData(f.width, f.height); id.data.set(f.data); x.putImageData(id, 0, 0); return c.toDataURL("image/png").split(",")[1]; }); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.from(png, "base64")); };

await page.goto(url + "/"); await page.evaluate(() => B.eraseDb());
await check("first boot in Chrome: kodeOS up, the factory apps seeded and listed", async () => {
  await open();
  assert.deepEqual(await names(), ["kody_kart", "display_lvgl", "buttons_led"]);
  assert.equal(await page.evaluate(() => S.program.kind), "os");
  assert.match(await page.evaluate(() => B.text()), /apps region ready: 3 app\(s\)/);
});
await check("launch Kody Kart through the system object, then home: back in kodeOS with FROM_APP", async () => {
  await page.evaluate(() => { B.events.length = 0; return S.launch(S.list()[0].id); });
  await until(() => S.program?.kind === "app" && S.program.name === "Kody Kart", 60000, "the app");
  await until(() => /kart_ao/.test(B.text()), 60000, "the app's log");
  await new Promise((r) => setTimeout(r, 2500));
  await snap(path.join(shots, "07-browser-kody-kart.png"));
  await page.evaluate(() => S.home());
  await until(() => S.program?.kind === "os" && /back from the user app/.test(B.text()), 60000, "FROM_APP");
});
await check("run-time install and delete, then a full page reload: the new app is there, the deleted one is not", async () => {
  await page.evaluate(() => B.install("crash_app"));
  await until(() => S.program?.kind === "os" && S.list().length === 4, 60000, "the install");
  await page.evaluate(() => S.remove(S.list().find((a) => a.project === "display_lvgl").id));
  await until(() => S.list().length === 3 && S.program?.kind === "os", 60000, "the delete");
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { S.stop(); return S.flushPersist(); });
  await open();
  assert.deepEqual(await names(), ["kody_kart", "buttons_led", "crash_app"]);
  assert.ok(await page.evaluate(() => S.list().every((a) => a.hasBundle)));
  const before = errors.length;
  await page.evaluate(() => S.launch(S.list()[2].id));
  await until(() => S.program?.kind === "app" && /crash_app: started/.test(B.text()), 60000, "crash_app after the reload");
  await until(() => S.program?.kind === "os" && /crash_app: aborting/.test(B.text()), 60000, "the crash returns to kodeOS");
  assert.ok(errors.slice(before).every((e) => /ErrorEvent/.test(e)), "only the app worker's abort surfaces as an error event: " + errors);
  errors.length = before;
});
assert.deepEqual(errors, [], "page errors");
await browser.close(); srv.close();
console.log(failed ? "BROWSER BOOT TESTS FAILED" : "BROWSER BOOT TESTS PASSED");
process.exit(failed ? 1 : 0);
