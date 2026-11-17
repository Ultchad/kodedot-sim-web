// The computer on the USB cable against the REAL kodeOS (console AO, AppMgr, kdrv_apps, kdrv_kfw) in the DotbenchSystem:
//   plug, ping, console verbs over the link, installing a .dotbench-derived app the way kcli does (direct, mailbox, container),
//   app data pushed over the link, launch, survival of a restart, the error paths of the real AppMgr.
// tests/node/usb/run.sh builds what is needed.
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeSystem, tmpDir, sleep, waitFor, renamePackage, pkgBytes, FACTORY } from "./syslib.mjs";
import { UsbComputer, UsbError } from "../../../runtime/web-adapter/usb-computer.js";
import { crc32le } from "../../../runtime/web-adapter/kapps.js";
import { readPackageInfo } from "../../../runtime/web-adapter/dotbench-system.js";

let failed = 0, passed = 0;
const only = process.env.USB_ONLY;
const check = async (name, fn) => {
  if (only && !name.includes(only)) return;
  try { await fn(); passed++; console.log("ok   - " + name); } catch (e) { failed++; console.log("FAIL - " + name + "\n" + e.stack); }
};

const dir = tmpDir("dbusb-");
let sys = makeSystem(dir);
let pc = new UsbComputer(sys);
const log = () => sys.logText();
import { buildDir } from "./syslib.mjs";
import path from "node:path";
const basePath = path.join(buildDir(), "apps/kody_kart/kody_kart.dotbench");
const pkg = (project, display, version = "1.2.3") => renamePackage(basePath, project, display, version);
const projects = () => sys.list().map((a) => a.project);
const waitOs = (what) => waitFor(() => sys.program?.kind === "os" && /kgui first frame/.test(log()), 120000, what ?? "kodeOS up", sys);

await check("power on: kodeOS up with the factory apps; the cable is out and the Dot knows it", async () => {
  await sys.start(); await waitOs();
  assert.deepEqual(projects(), FACTORY);
  assert.equal(pc.plugged, false);
});

await check("plug the computer: VBUS reaches the power area (the Dot logs it, charging starts), console answers ping", async () => {
  assert.equal(pc.plug(), true);
  await waitFor(() => /USB plugged in|usb.*present|vbus/i.test(log()) || sys.area("power").cable() === "usb", 15000, "cable noticed", sys);
  assert.equal(sys.area("power").cable(), "usb");
  assert.equal(await pc.ping(), "pong");
});

await check("console over the link: the typed line is echoed, a verb answers records and >ok, appdata_ls lists the factory apps", async () => {
  pc.clearTerminal();
  const rec = await pc.cmd("appdata_ls");
  assert.ok(rec.some((r) => /kody_kart/.test(r)), rec.join("\n"));
  assert.match(pc.terminal(), /appdata_ls/);       // the Dot's line editor echoes what the computer typed
});

await check("unplug and plug again: the console is gone while unplugged, comes back", async () => {
  pc.unplug();
  await assert.rejects(() => pc.ping(500), /not plugged/);
  await waitFor(() => sys.area("power").cable() === "none", 10000, "unplugged", sys);
  pc.plug(); assert.equal(await pc.ping(), "pong");
});

let ids = {};
await check("install over the cable, direct (kcli install + appdata put): the real AppMgr writes the apps region, the app is listed with its name and icon", async () => {
  const b = pkg("usbone", "USB One");
  const r = await pc.installPackage(b, { run: false });
  ids.one = r.id;
  const l = sys.list().find((a) => a.project === "usbone");
  assert.ok(l, "listed: " + projects());
  assert.equal(l.name, "USB One"); assert.equal(l.version, "1.2.3"); assert.ok(l.hasBundle);
  const fsApi = sys.area("storage");
  const info = await readPackageInfo(b);
  assert.deepEqual([...fsApi.read("/storage/.kode/appsdata/usbone/app.json")], [...info.board.json]);
  assert.equal(fsApi.stat("/storage/.kode/appsdata/usbone/icon.k64").size, info.board.icon.length);
  const rec = (await pc.cmd('appdata_info name="usbone"')).join("\n");
  assert.match(rec, /USB One/); assert.match(rec, /icon/);
});

await check("install with run=on: AppMgr asks for the boot and the page's bootloader starts the app's bundle", async () => {
  const b = pkg("usbtwo", "USB Two");
  const r = await pc.installPackage(b, { run: true });
  await waitFor(() => sys.program?.kind === "app" && sys.program.id === r.id, 60000, "the app to start", sys);
  assert.equal(sys.program.name, "USB Two");
  await sys.home(); await waitOs("back in kodeOS");
  assert.ok(projects().includes("usbtwo"));
});

await check("the Dot restarts into the app and the computer is still plugged in (re-plugged after each boot)", async () => {
  await waitFor(() => pc.plugged, 15000, "cable still in", sys);
  assert.equal(await pc.ping(), "pong");
});

await check("through the mailbox: install dst=pending parks the image, install src=pending dst=app adopts it", async () => {
  const b = pkg("usbmail", "USB Mailbox");
  await pc.installPackage(b, { via: "mailbox", run: false });
  await waitFor(() => projects().includes("usbmail"), 30000, "adopted", sys);
  assert.equal(sys.list().find((a) => a.project === "usbmail").name, "USB Mailbox");
  assert.match(log(), /adopted|installed|mailbox/i);
});

await check("a KFW1 container with the app-data block: AppMgr writes app.json and icon.k64 itself", async () => {
  const b = pkg("usbkfw", "USB Container");
  await pc.installPackage(b, { container: true, run: false });
  await waitFor(() => projects().includes("usbkfw"), 30000, "installed", sys);
  // AppMgr wrote the folder itself, on the card (the medium it prefers when one is mounted): its own appdata_info says what it resolved
  const rec = (await pc.cmd('appdata_info name="usbkfw"')).join("\n");
  assert.match(rec, /medium=sd/); assert.match(rec, /field=description src=folder/); assert.match(rec, /field=icon src=folder value=icon status=ok/);
});

await check("file transfer: file_put to /storage and file_get back, byte for byte; a card file too", async () => {
  const data = Uint8Array.from({ length: 10000 }, (_, i) => (i * 7 + 3) & 255);
  await pc.filePut("/storage/usb_test.bin", data);
  const got = await pc.fileGet("/storage/usb_test.bin");
  assert.deepEqual([...got.data], [...data]);
  assert.deepEqual([...sys.area("storage").read("/storage/usb_test.bin")], [...data]);
});

const before = () => projects().join(",");
await check("error: bytes that are neither an image nor a container are refused after the transfer, nothing is installed", async () => {
  const b = projects().join(",");
  const junk = new Uint8Array(6000).fill(0x41);
  await assert.rejects(() => pc.stream(junk, `install src="terminal" dst=app size=${junk.length} crc32=${crc32le(0, junk)} run=off`, "install"), UsbError);
  assert.equal(before(), b);
  assert.equal(await pc.ping(), "pong", "the console is back");
});

await check("error: a size the apps region cannot hold is refused before a byte is sent", async () => {
  const e = await pc.command('install src="terminal" dst=app size=9000000 crc32=1 run=off', 8000);
  assert.ok(e.term && e.term.startsWith(">err"), String(e.term));
  assert.equal(await pc.ping(), "pong");
});

await check("error: a wrong CRC-32 is refused at the end (a good image, a bad crc)", async () => {
  const { image } = await pc.prepare(pkg("usbbadcrc", "Bad CRC"));
  const b = projects().join(",");
  await assert.rejects(() => pc.stream(image, `install src="terminal" dst=app size=${image.length} crc32=12345 run=off`, "install"), UsbError);
  assert.equal(projects().join(","), b);
});

await check("error: unplugged mid-transfer: AppMgr's idle watchdog ends it, nothing is installed, replugging brings the console back", async () => {
  const { image } = await pc.prepare(pkg("usbcut", "Cut"));
  const padded = new Uint8Array(image.length + 20000); padded.set(image);   // longer than one 4 KB window
  const b = projects().join(",");
  const crc = crc32le(0, padded);
  await assert.rejects(() => pc.stream(padded, `install src="terminal" dst=app size=${padded.length} crc32=${crc} run=off`, "install", { abortAfter: 8192, onAbort: () => pc.unplug() }), /cable went away/);
  await waitFor(() => /no data for 5000 ms at 8192\/\d+ bytes; the host is presumed gone/.test(log()), 30000, "AppMgr gives up", sys);
  pc.plug(); await sleep(500); pc.drain();
  assert.equal(await pc.ping(15000), "pong");
  assert.equal(projects().join(","), b);
});

await check("a restart (page reload): every installed app, its name and its data folder are still there, and so is the cable's console", async () => {
  const had = projects();
  pc.dispose(); sys.stop(); sys.dispose();
  sys = makeSystem(dir); pc = new UsbComputer(sys);
  await sys.start(); await waitOs();
  assert.deepEqual(projects(), had);
  assert.equal(sys.list().find((a) => a.project === "usbone").name, "USB One");
  assert.ok(sys.area("storage").stat("/storage/.kode/appsdata/usbone/app.json").exists);
  pc.plug(); assert.equal(await pc.ping(), "pong");
});

await check("the development path: the image written into app_pending with the board off, the boot-time adoption installs it", async () => {
  await pc.flashMailbox(pkg("usbflash", "USB Flash"));
  await waitOs("kodeOS after the flash");
  await waitFor(() => projects().includes("usbflash"), 30000, "adopted at boot", sys);
  assert.equal(sys.list().find((a) => a.project === "usbflash").name, "USB Flash");
});

pc.dispose(); sys.stop(); sys.dispose();
console.log(`usb install: ${failed ? "FAILED" : "PASSED"} (${passed} ok, ${failed} failed)`);
process.exit(failed ? 1 : 0);
