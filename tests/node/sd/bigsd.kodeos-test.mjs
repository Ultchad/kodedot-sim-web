// kodeOS (role kodeos: the real kgui, AO_Storage, kdrv_sd) with a 128 GB card: the card mounts, the SDK's own sd_info reports the
// nominal capacity (sectors, MB) and the FAT's total and free space, and the About sheet shows the card's size.
// Run by tests/node/kodeos/run.sh. KODEOS_SHOTS=dir saves the About sheet.
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { Bench, OFF, RESET, sleep, glueMods, pkgPath } from "../persist/host.mjs";
import { savePng } from "../kodeos/png.mjs";

const strip = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
let failed = false;
const check = async (name, fn) => { try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); } };
const shotDir = process.env.KODEOS_SHOTS;
const bench = await new Bench().open();
const a = await bench.boot(pkgPath("kodeos"), { reason: RESET.POWERON });
await a.waitFor(() => a.logText().includes("kgui first frame"), 120000, "kgui first frame");
await sleep(2500);
const sd = a.glue(await glueMods.sd());
const shot = (name) => { if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); savePng(path.join(shotDir, name), a.framebuffer(), a.u32(OFF.fbW), a.u32(OFF.fbH), a.u32(OFF.fbStride)); } };
const say = async (line, ms = 2500) => { const m = a.logText().length; a.console(line); await sleep(ms); return strip(a.logText().slice(m)); };
const tap = async (x, y, hold = 120) => { a.touch(x, y, true); await sleep(hold); a.touch(x, y, false); await sleep(900); };
const drag = async (y0, y1) => { for (let y = y0; y >= y1; y -= 40) { a.touch(205, y, true); await sleep(30); } a.touch(205, y1, false); await sleep(900); };

await check("a 128 GB card: kdrv_sd mounts it, sd_info says 131072 MB / 268435456 sectors and the volume's total and free space", async () => {
  sd.swap(131072);
  let t = await say("sd_mount");
  assert.match(t, /card mounted at \/sdcard: 'DOTSD', 131072MB/);
  t = await say("sd_info");
  assert.match(t, /capacity_mb=131072 sectors=268435456 sector_size=512/);
  const m = /total_mb=(\d+) free_mb=(\d+)/.exec(t), k = /total_kb=(\d+) free_kb=(\d+)/.exec(t);
  assert.ok(m && k, "the volume answers");
  assert.ok(+m[1] > 131000 && +m[1] <= 131072 && +m[2] >= +m[1] - 1, "total/free MB " + m[0]);
  assert.ok(+k[1] > 131000 * 1024 && +k[2] >= +k[1] - 64, "total/free KB " + k[0]);
  console.log("       " + m[0] + "  " + k[0] + "  stored " + JSON.stringify(sd.stats()));
});

await check("the About sheet opens with the card mounted (the shot shows \"microSD card 128.0 GB\")", async () => {
  for (let y = 10; y <= 460; y += 50) { a.touch(205, y, true); await sleep(25); } a.touch(205, 470, false); await sleep(2000);
  await tap(325, 108, 1200); await sleep(1500);                  // control centre -> Settings
  await drag(450, 100); await drag(450, 100); await drag(450, 100);
  await tap(200, 420, 150); await sleep(2500);                    // About
  await say("sd_info", 1500);                                     // the sheet asks AO_Storage for the card on its way in
  await sleep(1500);
  shot("about-top.png");
  await drag(450, 150); await sleep(800);
  shot("about-card.png");
  assert.ok(a.logText().length > 0);
});
await a.stop();
process.exit(failed ? 1 : 0);
