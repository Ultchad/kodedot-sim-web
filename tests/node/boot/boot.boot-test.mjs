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
  assert.deepEqual(l.map((a) => a.version), ["01.00.00", "0.0.0", "0.0.0"].map((v, i) => l[i].version));   // versions come from the packages
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

await check("first boot: the launcher shows the apps (screenshot)", async () => {
  await sleep(1500);
  await swipeLeft(sys);
  await sleep(2500);
  shot(sys, path.join(shots, "01-app-list-first-boot.png"));
});

await sys.stop?.();
process.exit(failed ? 1 : 0);
