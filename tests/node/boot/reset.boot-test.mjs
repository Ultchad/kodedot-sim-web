// kodeOS's OWN factory reset (Settings -> About -> Factory reset), by touch, end to end (docs/STATUS-boot.md "Factory reset from kodeOS"):
//   the wipe runs every step (vault, BLE keys, BLE bonds, apps, files, settings), the board restarts, and the adapter plays the factory
//   image: the nine factory apps are back, the user's app is gone, settings are gone. Screenshots: docs/boot-shots/reset-*.png
import assert from "node:assert/strict";
import path from "node:path";
import { makeSystem, tmpDir, sleep, shot, tap, swipeLeft, waitFor, root, FULL_FACTORY, fullFactoryJson, pkgFile, renamePackage } from "./lib.mjs";

const shots = process.env.BOOT_SHOTS || path.join(root, "docs/boot-shots");
let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};

const dir = tmpDir();
const sys = makeSystem(dir, { factory: fullFactoryJson });
const log = () => sys.logText();
const osFrames = () => log().split("kgui first frame").length - 1;
const drag = async (x0, y0, x1, y1, steps = 8) => {
  for (let i = 0; i <= steps; i++) { sys.touch(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, true); await sleep(40); }
  sys.touch(x1, y1, false); await sleep(2500);
};
const tapAt = async (x, y) => { await tap(sys, x, y); await sleep(2500); };
const scrollUp = () => drag(200, 420, 200, 100);

await check("setup: a used device (nine factory apps, one of them removed, a user app, settings and files)", async () => {
  await sys.start();
  await waitFor(() => osFrames() > 0 && sys.program?.kind === "os", 120000, "kodeOS first frame", sys);
  await waitFor(() => /'buttons_led' copied to/.test(log()), 90000, "AppMgr finished its copies", sys);
  assert.deepEqual(sys.list().map((a) => a.project), FULL_FACTORY);
  const light = sys.list().find((a) => a.project === "light");
  await sys.remove(light.id);                                       // the user removed a factory app
  await sys.install(renamePackage(pkgFile("buttons_led"), "mine", "Mine", "1.2.3"));   // and installed one of their own
  await waitFor(() => sys.program?.kind === "os" && /kgui first frame/.test(log()), 90000, "kodeOS after install", sys);
  await sys.settled();
  assert.deepEqual(sys.list().map((a) => a.project), FULL_FACTORY.filter((n) => n !== "light").concat("mine"));
  await waitFor(() => sys.area("storage")?.mounted("storage") && sys.area("nvs"), 30000, "areas", sys);
  sys.area("nvs").set("dbtest", "volume", "u8", 7);
  sys.area("storage").mkdir("/storage/dbtest", { parents: true });
  sys.area("storage").write("/storage/dbtest/note.txt", new TextEncoder().encode("hello"));
  const fs = sys.area("storage");
  for (const f of ["mine", "kody_kart"]) fs.write("/storage/.kode/appsdata/" + f + "/saved.bin", new TextEncoder().encode("progress of " + f));   // an app's own data folder
  assert.equal(sys.area("nvs").get("dbtest", "volume").value, 7);
  await sys.flushPersist();
});

await check("Settings -> About -> Factory reset by touch: every wipe step passes, the board restarts, kodeOS comes up like new", async () => {
  await sleep(2000);
  await drag(205, 5, 205, 400);                       // the controls sheet
  await tapAt(325, 95);                                // the gear: Settings
  for (let i = 0; i < 3; i++) await scrollUp();        // to About (last row)
  await tapAt(200, 410);                               // About
  await scrollUp();                                    // Factory reset row at the bottom
  shot(sys, path.join(shots, "reset-1-about.png"));
  await tapAt(200, 420);                               // the row asks first
  shot(sys, path.join(shots, "reset-2-question.png"));
  assert.match(log(), /kgui.*factory reset|kgui\b/);
  const frames = osFrames();
  sys.lines.length = 0;
  await tap(sys, 205, 405);                            // "Reset"
  await waitFor(() => /factory reset: confirmed; AO_Boot is asked/.test(log()), 10000, "the confirmation", sys);
  await waitFor(() => /factory reset: restarting into/.test(log()) || /stopped at/.test(log()), 60000, "the wipe's end", sys);
  assert.doesNotMatch(log(), /stopped at|not implemented|Partly done|not done/, "no step stops\n" + log().split("\n").filter((l) => /factory|wipe|kgui|implemented/.test(l)).join("\n"));
  for (const step of ["find", "wipe", "apps", "files", "nvs", "done"]) assert.match(log(), new RegExp("factory reset: " + step), "step " + step);
  assert.doesNotMatch(log(), /kdrv_ble_unpair/);
  // the restart: the adapter boots kodeOS again, now on the wiped device
  await waitFor(() => sys.program?.kind === "os" && osFrames() > 0 && sys.status === "running", 120000, "kodeOS after the reset", sys);
  assert.match(log(), /kgui first frame/);
  void frames;
  await sleep(3000);
  shot(sys, path.join(shots, "reset-4-fresh-kodeos.png"));
});

await check("after the reset: the nine factory apps are back, the user's app and the removed-app state are gone, settings are gone", async () => {
  await sys.settled();
  await waitFor(() => sys.area("storage")?.mounted("storage") && sys.area("nvs"), 30000, "areas", sys);
  assert.deepEqual(sys.list().map((a) => a.project), FULL_FACTORY, "factory set, in list order");
  assert.ok(sys.list().every((a) => a.hasBundle), "every app has its bundle (it can launch)");
  assert.ok(!sys.list().some((a) => a.project === "mine"));
  assert.equal(sys.area("nvs").get("dbtest", "volume"), null, "the setting is gone");
  const fs = sys.area("storage");
  for (const f of ["mine", "kody_kart"]) assert.equal(fs.stat("/storage/.kode/appsdata/" + f + "/saved.bin").exists, false, f + ": the app's data folder was wiped");
  assert.equal(fs.stat("/storage/.kode/appsdata/mine/app.json").exists, false, "the user's app has no folder any more");
  await waitFor(() => fs.stat("/storage/.kode/appsdata/kody_kart/app.json").exists && fs.stat("/storage/.kode/appsdata/nfc_kit/icon.k64").exists, 30000, "the factory apps' board files are rewritten", sys);
  // what kodeOS's reset does NOT erase is a file outside the apps' data folders (it wipes settings, apps, their images and data folders; it does not format)
  assert.equal(fs.stat("/storage/dbtest/note.txt").exists, true);
  assert.equal(sys.lastUpdate.installed.length, 9, "the factory image was put back as a first boot");
  // kodeOS's own list: the nine apps (screenshots of the first page of "All")
  await swipeLeft(sys); await sleep(5000);
  await tap(sys, 200, 72); await sleep(3000);
  shot(sys, path.join(shots, "reset-5-apps-back.png"));
});

sys.stop();
process.exit(failed ? 1 : 0);
