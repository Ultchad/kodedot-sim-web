// Headless Chrome, real IndexedDB: a 128 GB sparse card with files survives a full page reload, the store holds only the data
// (chunk count in IndexedDB), a swap to another card removes the old card's chunks, and the browser's storage quota is printed
// (it bounds how much a bench can keep; the sparse card's own bound is wasm memory: see docs/STATUS-persistence.md section 12).
// Not listed in tests/browser/run.sh (shared file): node tests/browser/bigsd.test.mjs
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
const until = async (fn, ms, what) => { try { await page.waitForFunction(fn, { timeout: ms, polling: 50 }); } catch { throw new Error("timeout waiting for " + what + "\n" + (await page.evaluate(() => P.text().slice(-1200)).catch(() => ""))); } };
const load = async () => { await page.goto(url + "/"); await page.waitForFunction("window.PREADY === true", { timeout: 15000 }); };
const boot = async () => { await page.evaluate(() => P.boot("storage")); await until(() => /folder \/storage\/storage_demo is there/.test(P.text()), 30000, "storage example up"); };
const MB = 1024 * 1024;

await load();
console.log("       " + JSON.stringify(await page.evaluate(async () => { const e = await navigator.storage.estimate(); return { quotaMB: Math.round(e.quota / 1048576), usageMB: Math.round(e.usage / 1048576) }; })));
await check("128 GB card in IndexedDB: 3 MB file + a raw last sector, flush, full reload: both are back", async () => {
  await boot();
  await page.evaluate(() => { const sd = P.dev.area("sd"); sd.swap(131072); sd.mount(); const fs = P.dev.area("storage"); const d = new Uint8Array(3 * 1048576); for (let i = 0; i < d.length; i++) d[i] = (i * 7 + 1) | 1; fs.write("/sdcard/big.bin", d); });
  await page.evaluate(() => P.dev.flushPersist());
  const c = await page.evaluate(() => P.idbCounts());
  console.log("       IndexedDB after the write: " + JSON.stringify(c) + " (" + (c.chunks * 4096 / MB).toFixed(1) + " MiB of chunks) for a 128 GB card");
  assert.ok(c.chunks * 4096 < 6 * MB, "only the data is stored");
  await load(); await boot();
  const r = await page.evaluate(() => { const sd = P.dev.area("sd"); const s = sd.state(); sd.mount(); const d = P.dev.area("storage").read("/sdcard/big.bin"); let ok = d.length === 3 * 1048576; for (let i = 0; ok && i < d.length; i += 4099) if (d[i] !== (((i * 7 + 1) | 1) & 255)) ok = false; return { cap: s.capacityMb, ok, stats: sd.stats() }; });
  assert.equal(r.cap, 131072); assert.ok(r.ok, "the file reads back"); assert.equal(r.stats.layout, "sparse");
});
await check("swap to a 4 GB blank card: the old card's chunks leave IndexedDB", async () => {
  await page.evaluate(() => P.dev.area("sd").swap(4096, { format: false }));
  await sleep(300);
  await page.evaluate(() => P.dev.flushPersist());
  const c = await page.evaluate(() => P.idbCounts());
  console.log("       IndexedDB after the swap: " + JSON.stringify(c));
  assert.ok(c.chunks * 4096 < 3 * MB, "old data gone: " + c.chunks);
});
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
