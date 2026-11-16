// Apps live inside kodeOS (docs/STATUS-boot.md). Runs under Node through DotbenchSystem on a persistence directory:
//   1 first boot: the factory set is installed, kodeOS's list shows it (directory, AppMgr log, launcher screenshot)
//   2 launch Kody Kart by touch (the real path: kgui -> appmgr_run_request -> AO_Boot -> KRUN request -> restart -> page bootloader),
//     title frame, hold BOT 3000 ms, back in kodeOS with FROM_APP
//   3 install at run time, appears; delete from the OS's own UI, gone; both survive a "page reload"
//   4 BOT+LEFT retires a sticky request; a crash in an app returns to the OS; the keep list and the 64-entry/eviction rules
//   tests/node/boot/run.sh      screenshots: BOOT_SHOTS=dir (default docs/boot-shots)
import assert from "node:assert/strict";
import path from "node:path";
import { makeSystem, tmpDir, sleep, shot, swipeLeft, tap, waitFor, renamePackage, pkgBytes, root, FACTORY } from "./lib.mjs";
import { AppsFlash, AppsRegion, K, ROM, APPS_SIZE, tryBootRequestedApp, synthImage, planInstall } from "../../../runtime/web-adapter/kapps.js";
import { PersistManager } from "../../../runtime/web-adapter/persist.js";

const shots = process.env.BOOT_SHOTS || path.join(root, "docs/boot-shots");
let failed = false;
const only = process.env.BOOT_ONLY;
const check = async (name, fn) => {
  if (only && !name.includes(only)) return;
  try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};

const dir = tmpDir();
let sys = makeSystem(dir);
const log = () => sys.logText();

await check("first boot: factory apps are in the apps region (real directory) and kodeOS's AppMgr reads them", async () => {
  await sys.start();
  await waitFor(() => log().includes("kgui first frame"), 120000, "first frame", sys);
  assert.deepEqual(sys.program, { id: "os", name: "kodeOS", kind: "os" });
  const l = sys.list();
  assert.deepEqual(l.map((a) => a.project), FACTORY);
  assert.deepEqual(l.map((a) => a.name), ["Kody Kart", "Display", "Buttons + LED"]);
  assert.ok(l[0].version === "01.00.00", "kody_kart version: " + l[0].version);
  assert.match(log(), /kdrv\.apps\s*apps region ready: 3 app\(s\), gen=\d+/);
  assert.ok(!/apps region unreadable|another format/.test(log()));
  assert.ok(!/a kodeOS update never confirmed/.test(log()), "otadata must read blank");
});

await check("first boot: the data folders are on /storage (app.json and icon.k64), as the board keeps them", async () => {
  await sys.settled();
  const fsApi = sys.area("storage");
  const kart = fsApi.list("/storage/.kode/appsdata/kody_kart").map((f) => f.name).sort();
  assert.deepEqual(kart, ["app.json", "icon.k64"]);
  assert.equal(fsApi.stat("/storage/.kode/appsdata/kody_kart/icon.k64").size, 12288);
  assert.match(fsApi.readText("/storage/.kode/appsdata/kody_kart/app.json"), /"kode":"1"/);
  assert.ok(fsApi.stat("/storage/.kode/appsdata/display_lvgl/app.json").exists);
});

const gotoList = async (allY = 140) => {   // lock screen -> launcher -> the "All" group
  await swipeLeft(sys); await sleep(5000); await tap(sys, 200, allY); await sleep(2500);
};
const ROW = [140, 250, 362];

await check("first boot: the launcher shows the apps with their names and icons (screenshot)", async () => {
  await sleep(1500);
  await gotoList();
  shot(sys, path.join(shots, "01-app-list-first-boot.png"));
  assert.ok(sys.events.length === 1 && sys.events[0].kind === "os");
});

let kartId;
await check("launch Kody Kart by touch: the real path writes the KRUN request, the page boots the app's bundle", async () => {
  kartId = sys.list()[0].id;
  const statuses = []; const off = sys.on("status", (s) => statuses.push(s.status));
  await tap(sys, 200, ROW[0]);
  await waitFor(() => sys.program?.kind === "app", 60000, "the app to start", sys);
  assert.equal(sys.program.id, kartId); assert.equal(sys.program.name, "Kody Kart");
  assert.match(log(), /kgui launch: kody_kart/);
  await waitFor(() => /kart_ao .*demo race/.test(log()), 60000, "kart's own log", sys);
  await sleep(2500);
  shot(sys, path.join(shots, "02-kody-kart-title.png"));
  const f = sys.frame().data; let lit = 0; for (let i = 0; i < f.length; i += 4) if (f[i] | f[i + 1] | f[i + 2]) lit++;
  assert.ok(lit / (f.length / 4) > 0.5, "title frame is drawn");
  off();
  assert.ok(!statuses.includes("restart-requested") && !statuses.includes("crashed"), "the page never sees a restart: " + statuses);
  const req = new (await import("../../../runtime/web-adapter/kapps.js")).AppsRegion(sys._flash()); req.load();
  assert.equal(req.readReq().state, K.STATE.TRIED, "the bootloader consumed the NEW request");
});

await check("hold the bottom button 3000 ms in the app: back in kodeOS, which reads FROM_APP", async () => {
  sys.lines.length = 0;
  const t0 = Date.now();
  sys.button("bottom", true);
  await waitFor(() => sys.program?.kind === "os", 30000, "kodeOS", sys);
  const held = Date.now() - t0;
  sys.button("bottom", false);
  assert.ok(held >= 2900, "the app's own hold takes 3000 ms, took " + held);
  await waitFor(() => log().includes("kgui first frame"), 60000, "kodeOS first frame", sys);
  assert.match(log(), /kaos\.boot\s+back from the user app @0x010000/);
  assert.ok(!/a kodeOS update never confirmed|cleared a stale boot request/.test(log()));
  assert.equal(sys.list().length, 3);
  await sleep(1500); shot(sys, path.join(shots, "03-back-in-kodeos.png"));
});

let extraId;
await check("install a .dotbench at run time: it is stored, placed in the apps region, listed by kodeOS with its name and icon data", async () => {
  const pkg = renamePackage(`${process.env.DOTBENCH_BUILD || path.join(root, "build")}/apps/display_lvgl/display_lvgl.dotbench`, "zz_extra", "Extra Demo", "9.9.9");
  sys.lines.length = 0;
  const r = await sys.install(pkg);
  extraId = r.id;
  await waitFor(() => sys.program?.kind === "os" && log().includes("kgui first frame"), 60000, "kodeOS again", sys);
  await sys.settled();
  const l = sys.list();
  assert.deepEqual(l.map((a) => a.project), [...FACTORY, "zz_extra"]);
  assert.equal(l[3].name, "Extra Demo"); assert.equal(l[3].version, "9.9.9");
  assert.match(log(), /apps region ready: 4 app\(s\)/);
  assert.ok(sys.area("storage").stat("/storage/.kode/appsdata/zz_extra/app.json").exists);
  await gotoList(250);   // kgui re-focuses the last used group (Games): the carousel is one row lower
  shot(sys, path.join(shots, "04-app-list-after-install.png"));
});

await check("delete from kodeOS's own UI (hold the row, Remove, confirm): the real AppMgr erases it; the directory and the data folder follow", async () => {
  await tap(sys, 200, ROW[1], 1700);               // the row 'Display': its details card
  await sleep(1500);
  shot(sys, path.join(shots, "05-app-details.png"));
  for (let i = 0; i < 3; i++) { sys.button("top", true); await sleep(200); sys.button("top", false); await sleep(i === 1 ? 700 : 900); }
  await waitFor(() => !sys.list().some((a) => a.project === "display_lvgl"), 30000, "the app to leave the directory", sys);
  assert.deepEqual(sys.list().map((a) => a.project), ["kody_kart", "buttons_led", "zz_extra"]);
  await waitFor(() => !sys.area("storage").stat("/storage/.kode/appsdata/display_lvgl/app.json").exists, 20000, "data folder removed", sys);
  await sleep(1500);
});

await check("both survive a page reload (a fresh system on the same persistence directory)", async () => {
  sys.stop(); await sys.pm.flush(); await sleep(300);
  sys = makeSystem(dir);
  await sys.start();
  await waitFor(() => log().includes("kgui first frame"), 120000, "first frame", sys);
  assert.deepEqual(sys.list().map((a) => a.project), ["kody_kart", "buttons_led", "zz_extra"]);
  assert.ok(sys.list().every((a) => a.hasBundle));
  assert.equal(sys.list()[2].name, "Extra Demo");
  assert.match(log(), /apps region ready: 3 app\(s\)/);
  assert.deepEqual(sys.ignored, [], "region sizes agree with the firmware's (no region-ignored)");
  await gotoList(); shot(sys, path.join(shots, "06-app-list-after-reload.png"));
  const id = sys.list()[2].id;
  await sys.launch(id);
  await waitFor(() => sys.program?.id === id, 60000, "the installed app after the reload", sys);
  await waitFor(() => /Display|display/.test(log()) || sys.frameSeq > 0, 30000, "app output", sys);
  await sys.home();
  await waitFor(() => sys.program?.kind === "os", 60000, "home", sys);
  await waitFor(() => /back from the user app/.test(log()), 60000, "FROM_APP", sys);
});

await check("a sticky request survives the keep list; BOT+LEFT (power-on reset) retires it and kodeOS shows the list", async () => {
  const id = sys.list()[0].id;
  await waitFor(() => log().includes("kgui first frame"), 60000, "kodeOS", sys);
  await sys.launch(id, { sticky: true });
  await waitFor(() => sys.program?.id === id, 60000, "app", sys);
  const rd = async () => { const { AppsRegion } = await import("../../../runtime/web-adapter/kapps.js"); const r = new AppsRegion(sys._flash()); r.load(); return r.readReq().state; };
  assert.equal(await rd(), K.STATE.ARMED);
  sys.button("bottom", true); await sleep(3600); sys.button("bottom", false);      // the app's own home hold: a software reset
  await sleep(4000);
  assert.equal(sys.program.id, id, "ARMED + a software reset: the sticky app boots again");
  sys.lines.length = 0;
  sys.button("bottom", true); sys.button("left", true);
  await waitFor(() => sys.program?.kind === "os", 60000, "kodeOS after the chord", sys);
  sys.releaseAll();
  assert.ok([K.STATE.TRIED, K.STATE.EMPTY].includes(await rd()), "the request is retired (TRIED by the bootloader, then cleared by AO_Boot)");
  await waitFor(() => log().includes("kgui first frame"), 60000, "kodeOS first frame", sys);
  assert.match(log(), /back from the user app|stale boot request/);
  assert.equal(sys.list().length, 3);
});

await check("a crash in an app returns to kodeOS (and the page only sees running states)", async () => {
  const bytes = pkgBytes("crash_app");
  await sys.install(bytes);
  await waitFor(() => sys.program?.kind === "os" && log().includes("kgui first frame"), 60000, "kodeOS", sys);
  const id = sys.list().find((a) => a.project === "crash_app").id;
  assert.equal(sys.list().find((a) => a.project === "crash_app").version, "0.3.1");
  const statuses = []; sys.on("status", (s) => statuses.push(s.status));
  sys.lines.length = 0;
  await sys.launch(id);
  await waitFor(() => sys.program?.id === id, 60000, "crash app", sys);
  await waitFor(() => log().includes("crash_app: aborting"), 20000, "its abort", sys);
  await waitFor(() => sys.program?.kind === "os" && log().includes("kgui first frame"), 60000, "kodeOS after the crash", sys);
  assert.ok(!statuses.includes("crashed"), "statuses: " + statuses);
  assert.equal(sys.status, "running");
});

await check("factory reset: a first boot again, the factory set only", async () => {
  await sys.factoryReset();
  await waitFor(() => sys.program?.kind === "os" && log().includes("kgui first frame"), 90000, "kodeOS", sys);
  assert.deepEqual(sys.list().map((a) => a.project), FACTORY);
});

sys.stop();
process.exit(failed ? 1 : 0);
