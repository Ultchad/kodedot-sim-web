// The factory set inside kodeOS (docs/STATUS-integration-2.md): a fresh device carries the thirteen apps of tools/factory-apps.json.
//   1 first boot: all thirteen are in the list with their names and icons (screenshots of every page of the "All" list)
//   2 each of the thirteen launches from the OS by touch, shows a first screen (not black), and returns to kodeOS with the bottom-button hold
//   3 saved data survives: a tag saved in nfc_kit is still there after going back to the OS and relaunching
//   screenshots: BOOT_SHOTS=dir (default docs/boot-shots)
import assert from "node:assert/strict";
import path from "node:path";
import { makeSystem, tmpDir, sleep, shot, swipeLeft, tap, waitFor, root, FULL_FACTORY, fullFactoryJson, pkgFile } from "./lib.mjs";
import fs from "node:fs";

const shots = process.env.BOOT_SHOTS || path.join(root, "docs/boot-shots");
let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log("ok   - " + name); } catch (e) { failed = true; console.log("FAIL - " + name + "\n" + e.stack); }
};

const NAMES = { kody_kart: "Kody Kart", light: "Light", nfc_kit: "NFC", rfid_kit: "RFID", ir_kit: "IR Remote", wifi_kit: "Wi-Fi", ble_kit: "Bluetooth", gpio_kit: "GPIO",
  level: "Level", files: "Files", sound: "Sound", display_lvgl: "Display", buttons_led: "Buttons + LED" };
const HAS_ICON = ["kody_kart", "light", "nfc_kit", "rfid_kit", "ir_kit", "wifi_kit", "ble_kit", "gpio_kit", "level", "files", "sound"];
// Where each app is in kodeOS's "All" list after `swipes` upward swipes of the list. Rows snap two at a time: with no swipe the rows
// are at y 125, 237, 350; after s swipes (s >= 1) rows 2s, 2s+1, 2s+2 are at y 140, 252, 364. -> [swipes, y]
const spot = (i) => { if (i <= 2) return [0, 125 + 112 * i]; const s = Math.ceil((i - 2) / 2); return [s, 140 + 112 * (i - 2 * s)]; };
const SPOT = Object.fromEntries(Object.keys(NAMES).map((n, i) => [n, spot(i)]));
const PAGES = Math.max(...Object.values(SPOT).map((x) => x[0]));
assert.deepEqual(FULL_FACTORY, Object.keys(NAMES), "the factory list is the thirteen apps in list order");

const dir = tmpDir();
const sys = makeSystem(dir, { factory: fullFactoryJson });
const log = () => sys.logText();
const osFrames = () => log().split("kgui first frame").length - 1;
const lit = () => { const f = sys.frame(); let n = 0; for (let i = 0; i < f.data.length; i += 4) if (f.data[i] | f.data[i + 1] | f.data[i + 2]) n++; return n / (f.data.length / 4); };
const swipeUp = async () => { for (let y = 420; y >= 200; y -= 20) { sys.touch(200, y, true); await sleep(30); } sys.touch(200, 200, false); await sleep(1500); };

const copies = () => (log().match(/'buttons_led' copied to/g) || []).length;
/** First boot: wait for kodeOS's first frame and for AppMgr's one-per-second copying of the apps to the card to end (it makes swipes lag). */
async function firstBoot() {
  await waitFor(() => osFrames() > 0 && sys.program?.kind === "os", 120000, "kodeOS first frame", sys);
  await waitFor(() => copies() > 0, 60000, "AppMgr finished its copies", sys);
}
/** Power-on reset to a known kodeOS (lock screen). The log ring is emptied first, so "first frame" can only be the new boot's. */
async function resetOs() {
  sys.lines.length = 0;
  await sys.powerOnReset();
  await waitFor(() => osFrames() > 0 && sys.program?.kind === "os", 120000, "kodeOS first frame", sys);
  await sleep(4000);
}
let ranApp = false;   // once an app has run, the group list shows it as a shortcut tile on top and "All" sits lower
async function openAll(swipes) {
  await sleep(1500);
  await swipeLeft(sys); await sleep(5000);
  await tap(sys, 200, ranApp ? 170 : 72); await sleep(2500);
  for (let i = 0; i < swipes; i++) await swipeUp();
}
/** From a power-on kodeOS: launch `name` by touch and wait for its first screen. */
async function launchByTouch(name) {
  const [swipes, y] = SPOT[name];
  await openAll(swipes);
  await tap(sys, 200, y);
  await waitFor(() => sys.program?.kind === "app", 60000, name + " starts", sys);
  assert.equal(sys.program.name, NAMES[name]);
  ranApp = true;
  // buttons_led has no screen (it drives the LED); its first "screen" is the green LED and its log line
  if (name === "buttons_led") await waitFor(() => /buttons_led green/.test(log()), 30000, "buttons_led shows green on the LED", sys);
  else await waitFor(() => lit() > 0.02, 30000, name + " draws its first screen", sys);
  await sleep(2500);
}
/** Hold the bottom button until kodeOS is back. @returns ms the press took until the OS was running */
async function holdHome() {
  const t0 = Date.now();
  sys.button("bottom", true);
  await waitFor(() => sys.program?.kind === "os", 30000, "back in kodeOS", sys);
  const ms = Date.now() - t0;
  sys.button("bottom", false);
  return ms;
}

await check("first boot: the thirteen factory apps are listed by kodeOS with names, versions and icons", async () => {
  await sys.start();
  await firstBoot();
  const l = sys.list();
  assert.deepEqual(l.map((a) => a.project), FULL_FACTORY);
  assert.deepEqual(l.map((a) => a.name), FULL_FACTORY.map((n) => NAMES[n]));
  assert.match(log(), /kdrv\.apps\s*apps region ready: 13 app\(s\)/);
  await sys.settled();
  const fsApi = sys.area("storage");
  for (const n of FULL_FACTORY) {
    const f = fsApi.list("/storage/.kode/appsdata/" + n).map((x) => x.name);
    assert.ok(f.includes("app.json"), n + " has app.json: " + f);
    assert.equal(f.includes("icon.k64"), HAS_ICON.includes(n), n + " icon.k64 on the volume: " + f);
  }
  await openAll(0);
  for (let p = 0; p <= PAGES; p++) { if (p) await swipeUp(); shot(sys, path.join(shots, `factory-list-${p}.png`)); }
});

await check("each of the thirteen launches from kodeOS by touch, shows its first screen, and returns with the bottom-button hold", async () => {
  for (const n of FULL_FACTORY) {
    await resetOs();
    await launchByTouch(n);
    shot(sys, path.join(shots, `app-${n}.png`));
    if (n !== "buttons_led") assert.ok(lit() > 0.02, n + " first screen is not black");
    const ms = await holdHome();
    // The SDK's home hold is 3000 ms. Kody Kart goes home on its own 1000 ms hold (kart_ao.c HOME_HOLD_MS); the two SDK examples are
    // built without the home hold, so the ordinary 600 ms hold of AO_Boot sends them home (buttons_led also resets on the press itself).
    const hold = { kody_kart: 1000, display_lvgl: 600, buttons_led: 0 }[n] ?? 3000;
    assert.ok(ms >= hold - 100, `${n}: back in kodeOS after ${ms} ms, before its ${hold} ms hold`);
    await waitFor(() => /kgui back from an app/.test(log().slice(-20000)), 60000, "kodeOS reads FROM_APP", sys);
    await waitFor(() => lit() > 0.02, 30000, "kodeOS list drawn", sys);
    await sleep(1500);
    if (n === "light") shot(sys, path.join(shots, "factory-back-in-kodeos.png"));
    console.log(`     ${n.padEnd(13)} ok, back in kodeOS ${ms} ms after the press`);
  }
});

await check("data of an app survives going back to kodeOS: a tag saved in NFC is still in Saved after relaunching", async () => {
  await resetOs();
  await launchByTouch("nfc_kit");
  const nfc = sys.area("nfc");
  assert.ok(nfc, "the nfc glue is present");
  nfc.objects().forEach((o) => o.remove());
  await tap(sys, 205, 116); await sleep(2500);                                    // Read
  nfc.tag({ type: "ntag215", uid: "04:11:22:33:44:55:66", text: "factory test", near: true });
  await sleep(6000);
  await tap(sys, 205, 432); await sleep(2500);                                    // Save -> name page
  shot(sys, path.join(shots, "factory-nfc-name.png"));
  await tap(sys, 205, 432); await sleep(2500);                                    // Save with the proposed name
  await tap(sys, 205, 432); await sleep(2000);                                    // Done
  await sys.settled();
  await sys.flushPersist();
  const f = sys.area("storage").stat("/storage/nfc_kit/saved.bin");
  assert.ok(f.exists && f.size > 0, "saved.bin is on /storage: " + JSON.stringify(f));
  const size = f.size;
  await holdHome();
  await waitFor(() => /kgui back from an app/.test(log().slice(-20000)), 60000, "kodeOS", sys);
  await sleep(1500);
  await resetOs();   // and a power cycle for good measure
  assert.equal(sys.area("storage").stat("/storage/nfc_kit/saved.bin").size, size, "the file is untouched by the OS");
  await launchByTouch("nfc_kit");
  await tap(sys, 205, 208); await sleep(3000);                                    // Saved
  shot(sys, path.join(shots, "factory-nfc-saved-after-relaunch.png"));
  const f2 = sys.frame();
  const px = (x, y) => { const i = (y * f2.width + x) * 4; return f2.data[i] | f2.data[i + 1] | f2.data[i + 2]; };
  assert.ok(px(100, 116) !== 0, "the saved card is listed as the first row of Saved");
  await holdHome();
});

console.log(failed ? "factory: FAILED" : "factory: PASSED");
process.exit(failed ? 1 : 0);
