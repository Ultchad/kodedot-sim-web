// Updates for a device that already exists (docs/STATUS-boot.md "Updates and factory resets"): the site ships more and newer factory apps than the
// stored Dot has. Each phase is a "page load" on the same persistence directory.
//   1 migration: a store from before records (only `seeded`, three apps) + a list of nine -> nine apps, user data kept
//   2 a factory app the user removed stays removed across an update (and a changed package for it does not bring it back)
//   3 a changed package replaces the installed one, the app's saved data survives
//   4 apps the user installed (also one under a factory app's name) are never touched
//   5 kodeOS always runs the bundle the page hands in; settings and files survive an OS update
import assert from "node:assert/strict";
import { makeSystem, tmpDir, sleep, waitFor, pkgBytes, pkgFile, renamePackage, FACTORY, FULL_FACTORY, fullFactoryJson, factoryJson } from "./lib.mjs";

let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};
const enc = new TextEncoder(), dec = new TextDecoder();
const bootOs = async (sys) => {
  await sys.start();
  await waitFor(() => sys.program?.kind === "os" && /kgui first frame/.test(sys.logText()), 120000, "kodeOS first frame", sys);
  await waitFor(() => sys.area("storage")?.mounted("storage") && sys.area("nvs"), 30000, "areas", sys);
  await sys.settled();
};
const projects = (sys) => sys.list().map((a) => a.project);
/** Power off with everything committed (a closed tab). */
const close = async (sys) => { await sys.flushPersist(); sys.stop(); sys.dispose?.(); };
const dir = tmpDir();

await check("1 migration: an old store (seeded flag, three apps) gets the six new apps; settings and files stay", async () => {
  const a = makeSystem(dir, { factory: factoryJson });
  await bootOs(a);
  assert.deepEqual(projects(a), FACTORY);
  a.area("nvs").set("dbtest", "volume", "u8", 9);
  a.area("storage").mkdir("/storage/dbtest", { parents: true });
  a.area("storage").write("/storage/dbtest/note.txt", enc.encode("kept"));
  const light0 = null; void light0;
  // turn it into a store from before records: only the bare `seeded` flag
  const store = a._bundles(); const idx = store._read(); delete idx.factory; delete idx.os; store._write(idx);
  assert.equal(store.seeded, true); assert.equal(store.factoryRecords(), null);
  await close(a);

  const b = makeSystem(dir, { factory: fullFactoryJson });
  const updates = []; b.on("update", (r) => updates.push(r));
  await bootOs(b);
  assert.deepEqual(projects(b).sort(), [...FULL_FACTORY].sort(), "nine apps");
  assert.deepEqual(updates[0].installed.sort(), FULL_FACTORY.filter((n) => !FACTORY.includes(n)).sort(), "the six new ones were installed");
  assert.deepEqual(updates[0].updated, [], "the three old ones are the same bytes: untouched");
  assert.equal(b.area("nvs").get("dbtest", "volume").value, 9);
  assert.equal(dec.decode(b.area("storage").read("/storage/dbtest/note.txt")), "kept");
  assert.ok(b.list().every((x) => x.hasBundle));
  assert.deepEqual(Object.keys(b._bundles().factoryRecords()).sort(), fullFactoryJson.apps.slice().sort());
  await close(b);
});

await check("2 a factory app the user removed stays removed across updates; unseen apps are not 'removed'", async () => {
  const b = makeSystem(dir, { factory: fullFactoryJson });
  await bootOs(b);
  await b.remove(b.list().find((x) => x.project === "light").id);
  await waitFor(() => b.program?.kind === "os" && b.area("storage")?.mounted("storage"), 60000, "OS", b);
  await close(b);
  // a later visit, the site ships a CHANGED light package and a new list entry: light stays removed
  const newLight = renamePackage(pkgFile("light"), "light", "Light", "2.0.0");
  const c = makeSystem(dir, { factory: fullFactoryJson, fetch: async (n) => (n === "light.dotbench" ? newLight : null) });
    await bootOs(c);
  assert.ok(!projects(c).includes("light"), "light is still removed");
  assert.equal(projects(c).length, 8);
  assert.equal(c._bundles().factoryRecords()["light.dotbench"].removed, true, "recorded as removed by the user, not as never seen");
  assert.deepEqual(c.lastUpdate.updated, [], "the changed package of a removed app is not installed");
  assert.deepEqual(c.lastUpdate.installed, []);
  await close(c);
});

await check("3 a changed package replaces the installed one; the app's saved data survives", async () => {
  const d1 = makeSystem(dir, { factory: fullFactoryJson });
  await bootOs(d1);
  d1.area("storage").write("/storage/.kode/appsdata/display_lvgl/saved.bin", enc.encode("progress"));
  const before = d1.list().find((x) => x.project === "display_lvgl");
  assert.equal(before.version, "0.0.0");
  await close(d1);
  const newer = renamePackage(pkgFile("display_lvgl"), "display_lvgl", "Display", "2.0.0");
  const d2 = makeSystem(dir, { factory: fullFactoryJson, fetch: async (n) => (n === "display_lvgl.dotbench" ? newer : null) });
  const ups = []; d2.on("update", (r) => ups.push(r));
  await bootOs(d2);
  const after = d2.list().find((x) => x.project === "display_lvgl");
  assert.equal(after.version, "2.0.0");
  assert.notEqual(after.id, before.id);
  assert.ok(after.hasBundle);
  assert.ok(!d2._bundles().has(before.id), "the old bundle is gone");
  assert.deepEqual(ups[0].updated, ["display_lvgl"]);
  assert.equal(d2.list().filter((x) => x.project === "display_lvgl").length, 1, "replaced, not duplicated");
  assert.equal(dec.decode(d2.area("storage").read("/storage/.kode/appsdata/display_lvgl/saved.bin")), "progress", "saved data survives");
  assert.deepEqual(projects(d2).sort(), FULL_FACTORY.filter((n) => n !== "light").sort());
  // the record follows: a third visit with the same list does nothing
  await close(d2);
  const d3 = makeSystem(dir, { factory: fullFactoryJson, fetch: async (n) => (n === "display_lvgl.dotbench" ? newer : null) });
  const ups3 = []; d3.on("update", (r) => ups3.push(r));
  await bootOs(d3);
  assert.deepEqual(ups3, [], "nothing to update the third time");
  await close(d3);
});

await check("4 apps the user installed are never touched (also one that takes a factory app's name)", async () => {
  const mine = renamePackage(pkgFile("buttons_led"), "mine", "Mine", "1.0.0");
  const e1 = makeSystem(dir, { factory: fullFactoryJson });
  await bootOs(e1);
  await e1.install(mine);
  await waitFor(() => e1.program?.kind === "os" && e1.area("storage")?.mounted("storage"), 60000, "OS", e1);
  // the user's own build of "level" over the factory one
  const own = renamePackage(pkgFile("level"), "level", "My Level", "7.7.7");
  await e1.install(own);
  await waitFor(() => e1.program?.kind === "os" && e1.area("storage")?.mounted("storage"), 60000, "OS", e1);
  await e1.settled();
  const ownId = e1.list().find((x) => x.project === "level").id;
  await close(e1);
  // the site ships a changed level and a changed sound
  const lvl = renamePackage(pkgFile("level"), "level", "Level", "3.0.0");
  const snd = renamePackage(pkgFile("sound"), "sound", "Sound", "3.0.0");
  const e2 = makeSystem(dir, { factory: fullFactoryJson, fetch: async (n) => (n === "level.dotbench" ? lvl : n === "sound.dotbench" ? snd : null) });
  const ups = []; e2.on("update", (r) => ups.push(r));
  await bootOs(e2);
  assert.ok(projects(e2).includes("mine"), "the user's app is there");
  assert.equal(e2.list().find((x) => x.project === "mine").version, "1.0.0");
  assert.equal(e2.list().find((x) => x.project === "level").id, ownId, "the user's build of level is untouched");
  assert.equal(e2.list().find((x) => x.project === "sound").version, "3.0.0", "the unmodified factory app was updated");
  assert.deepEqual(ups[0].kept, ["level"]);
  await close(e2);
});

await check("5 kodeOS runs the bundle the page hands in, never a stored one; settings and files survive an OS update", async () => {
  const dir5 = tmpDir();
  const stale = renamePackage(pkgFile("kodeos"), "kodeos", "kodeOS", "0.0.1-stale");
  const real = pkgBytes("kodeos");
  const f1 = makeSystem(dir5, { factory: factoryJson, os: stale });
  await bootOs(f1);
  assert.equal(f1.appInfo.version, "0.0.1-stale");
  f1.area("nvs").set("dbtest", "volume", "u8", 5);
  f1.area("storage").mkdir("/storage/dbtest", { parents: true });
  f1.area("storage").write("/storage/dbtest/note.txt", enc.encode("still here"));
  await close(f1);
  const f2 = makeSystem(dir5, { factory: factoryJson, os: real });
  const ups = []; f2.on("update", (r) => ups.push(r));
  await bootOs(f2);
  assert.notEqual(f2.appInfo.version, "0.0.1-stale");
  assert.equal(f2.program.kind, "os");
  assert.ok(ups[0]?.os?.from && ups[0].os.from !== ups[0].os.to, "the update reports the OS change");
  assert.equal(f2._bundles().ids().filter((id) => f2._bundles().info(id).project === "kodeos").length, 0, "no OS bundle is ever stored");
  assert.equal(f2.area("nvs").get("dbtest", "volume").value, 5);
  assert.equal(dec.decode(f2.area("storage").read("/storage/dbtest/note.txt")), "still here");
  await close(f2);
});

process.exit(failed ? 1 : 0);
