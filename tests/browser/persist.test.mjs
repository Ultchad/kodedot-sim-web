// Headless Chrome: what an app wrote survives a FULL page reload through IndexedDB (debounced flush, stop flush), the device clock
// and files written from the page too, and "erase device" clears the store so the next boot is a factory-fresh device.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { startPersistServer } from "./persist-server.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);
let puppeteer;
for (const p of ["puppeteer-core", path.join(here, "../../web/node_modules/puppeteer-core"), "/home/claude/dotbench/web/node_modules/puppeteer-core"]) { try { puppeteer = require(p); break; } catch {} }
if (!puppeteer) throw new Error("puppeteer-core not found");
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + (e.stack ?? e)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { srv, url } = await startPersistServer(0);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const until = async (fn, ms, what) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 50 }); } catch { throw new Error("timeout waiting for " + what + "\n" + (await page.evaluate(() => P.text().slice(-1200)).catch(() => ""))); } };
const load = async () => { await page.goto(url + "/"); await page.waitForFunction("window.PREADY === true", { timeout: 15000 }); };
const press = async (id) => { await page.evaluate((id) => { P.dev.button(id, true); }, id); await sleep(80); await page.evaluate((id) => { P.dev.button(id, false); }, id); };
const bootStorage = async () => { await page.evaluate(() => P.boot("storage")); await until(() => /folder \/storage\/storage_demo is there/.test(P.text()), 30000, "storage example up"); };

await load();
await check("page 1: factory-fresh device, the app writes a line and a setting; a file and the clock are set from the page", async () => {
  assert.deepEqual(await page.evaluate(() => P.idbCounts()), { chunks: 0, meta: 0 });
  await bootStorage();
  assert.ok(await page.evaluate(() => /storage boot number 1;/.test(P.text())));
  await press("top");
  await until(() => /line written/.test(P.text()), 8000, "the app's write");
  await page.evaluate(() => { const fs = P.dev.area("storage"); fs.mkdir("/storage/page"); fs.write("/storage/page/hello.txt", "written from the page"); P.dev.area("time").set(Date.UTC(2033, 2, 4, 5, 6, 7)); });
  // no explicit flush: the debounce timer in poll() does it (800 ms quiet; wait up to 15 s, a loaded host stretches the polls)
  let c = await page.evaluate(() => P.idbCounts());
  for (let t0 = Date.now(); !(c.meta === 1 && c.chunks >= 3) && Date.now() - t0 < 15000;) { await sleep(300); c = await page.evaluate(() => P.idbCounts()); }
  assert.ok(c.meta === 1 && c.chunks >= 3, "chunks reached IndexedDB without a stop: " + JSON.stringify(c));
  assert.ok((await page.evaluate(() => P.dev.persist)).flushes >= 1);
});

await check("full page reload: boot counter, the app's file, the page's file and the clock are all still there", async () => {
  await load();
  assert.ok(await page.evaluate(() => P.dev.persist.backend));
  await bootStorage();
  assert.ok(await page.evaluate(() => /storage boot number 2;/.test(P.text())), "the setting survived");
  assert.ok(await page.evaluate(() => !/will not mount/.test(P.text())), "the volume was not re-formatted");
  await press("bot");
  await until(() => /1 lines read/.test(P.text()), 8000, "read back");
  assert.ok(await page.evaluate(() => /boot 1 press 1 at \d+ ms/.test(P.text())), "the line written before the reload");
  assert.equal(await page.evaluate(() => P.dev.area("storage").readText("/storage/page/hello.txt")), "written from the page");
  const now = await page.evaluate(() => P.dev.area("time").now());
  assert.ok(Math.abs(now - Date.UTC(2033, 2, 4, 5, 6, 7)) < 60000, "clock: " + new Date(now).toISOString());
});

await check("stop() commits everything (no debounce wait): write, stop, reload", async () => {
  await page.evaluate(() => P.dev.area("storage").write("/storage/page/late.txt", "just before stop"));
  await page.evaluate(() => { P.dev.stop(); return P.dev.flushPersist(); });
  await load();
  await bootStorage();
  assert.equal(await page.evaluate(() => P.dev.area("storage").readText("/storage/page/late.txt")), "just before stop");
});

await check("erase device: IndexedDB is emptied, the next boot after a reload is factory fresh", async () => {
  await page.evaluate(() => P.dev.eraseDevice());
  assert.deepEqual(await page.evaluate(() => P.idbCounts()), { chunks: 0, meta: 0 }, "durable store empty");
  await load();
  await bootStorage();
  const t = await page.evaluate(() => P.text());
  assert.match(t, /storage boot number 1;/, "the setting is gone");
  assert.match(t, /will not mount: a new board/, "the volume is blank again");
  assert.equal(await page.evaluate(() => P.dev.area("storage").stat("/storage/page/hello.txt").exists), false);
  const now = await page.evaluate(() => P.dev.area("time").now());
  assert.ok(Math.abs(now - Date.now()) < 5000, "the clock is the host's again");
});

await check("export the device to one file in the page, erase, import it back: everything returns", async () => {
  await page.evaluate(() => P.dev.area("storage").write("/storage/exp.txt", "exported"));
  const bytes = await page.evaluate(() => Array.from(P.dev.exportDeviceFile()));
  assert.ok(bytes.length > 100);
  await page.evaluate(() => { P.dev.stop(); return P.dev.eraseDevice(); });
  await page.evaluate((b) => P.dev.importDeviceFile(new Uint8Array(b)), bytes);
  await load();
  await bootStorage();
  assert.equal(await page.evaluate(() => P.dev.area("storage").readText("/storage/exp.txt")), "exported");
});
if (errors.length) console.log("page errors:", errors);
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
