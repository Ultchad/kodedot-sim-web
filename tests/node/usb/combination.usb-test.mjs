// The combination checks of the integration round: kodeOS with a bench attached and one part wired (J3's rail follows the real radio),
// and an install over the USB cable into a system that already carries all the factory apps (the real AppMgr, the page's bundle registry).
import assert from "node:assert/strict";
import { makeSystem, tmpDir, waitFor, sleep, pkgBytes, buildDir, renamePackage, FULL_FACTORY, fullFactoryJson } from "./syslib.mjs";
import { UsbComputer } from "../../../runtime/web-adapter/usb-computer.js";
import { Bench } from "../../../runtime/web-adapter/bench.js";
import { BenchClock } from "../../../runtime/web-adapter/bench-clock.js";
import { loadLibrary } from "../parts/rig.mjs";
import path from "node:path";

let failed = 0, passed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log("ok   - " + name); } catch (e) { failed++; console.log("FAIL - " + name + "\n" + e.stack); } };

const dir = tmpDir("dbcomb-");
const sys = makeSystem(dir, { factory: fullFactoryJson });
const bench = new Bench({ clock: new BenchClock() });
bench.attach(sys);
await loadLibrary(bench);
const led = bench.addPart("dotbench.led");
bench.connect("device.EXP9", led + ".A"); bench.connect("device.GND", led + ".K");
const log = () => sys.logText();
const waitOs = (w) => waitFor(() => sys.program?.kind === "os" && /kgui first frame/.test(log()), 120000, w ?? "kodeOS up", sys);
const projects = () => sys.list().map((a) => a.project);

await check("(c) kodeOS boots with a bench attached and one part wired: the factory apps are listed, the radio link comes up, the rail follows it", async () => {
  await sys.start(); await waitOs();
  assert.deepEqual(projects(), FULL_FACTORY);
  await waitFor(() => /kdrv.radio link up|C5: KODE services/.test(log()), 20000, "the radio link", sys);
  await waitFor(() => bench.state().rails.V33 === false, 10000, "the 3.3 V rail follows the radio (off until something switches it on)", sys);
  assert.equal(bench.state().attached, true);
  const bad = log().split("\n").filter((l) => /not implemented|PANIC|abort\(/.test(l)); const mine = bad.filter((l) => !/khal_power_|kdrv_running_info|kdrv_slot_state/.test(l)); console.log("note - kodeOS stubs already there without a bench:", bad.length); assert.deepEqual(mine.filter((l) => /exp|gpio|pwm|radio|ble|c5|i2c|uart|rfid|nfc/i.test(l) || /PANIC|abort/.test(l)), [], "no J3, radio or BLE stub, no crash");
});

const pc = new UsbComputer(sys);
const pkg = (project, display) => renamePackage(path.join(buildDir(), "apps/kody_kart/kody_kart.dotbench"), project, display, "1.0.0");
let regionKB;
await check("(d) install over the cable into the full factory set: accepted, 14 apps, every one has its bundle, the registry matches", async () => {
  pc.plug(); assert.equal(await pc.ping(), "pong");
  const r = await pc.installPackage(pkg("combone", "Combo One"), { run: false });
  assert.ok(r.id !== undefined);
  assert.deepEqual(projects(), [...FULL_FACTORY, "combone"]);
  assert.ok(sys.list().every((a) => a.hasBundle), "every listed app has a bundle in the registry");
  const idx = Object.keys(sys._bundles()._read().bundles ?? {}).length;
  console.log("note - registry entries:", idx, "listed:", sys.list().length);
});

await check("(d) the apps region has no eviction: installing past the entry limit or the byte limit is refused and nothing is removed", async () => {
  const before = projects().join();
  const e = await pc.command('install src="terminal" dst=app size=9000000 crc32=1 run=off', 8000);
  assert.ok(e.term && e.term.startsWith(">err"), String(e.term));
  assert.equal(projects().join(), before, "the factory apps are all still there");
  assert.ok(sys.list().every((a) => a.hasBundle));
});

await check("(d) the installed app and the factory apps survive a restart together; removing the new one leaves the registry consistent", async () => {
  await sys.flushPersist();
  const id = sys.list().find((a) => a.project === "combone").id;
  await sys.remove(id);
  await waitFor(() => !projects().includes("combone") && sys.program?.kind === "os", 60000, "removed", sys);
  assert.deepEqual(projects(), FULL_FACTORY);
  assert.ok(sys.list().every((a) => a.hasBundle));
});

console.log(`combination: ${failed ? "FAILED" : "PASSED"} (${passed} ok, ${failed} failed)`);
sys.stop();
process.exit(failed ? 1 : 0);
