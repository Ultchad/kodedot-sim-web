// kodeOS's Bluetooth page by touch, over the BLE area: the page opens from the control centre, shows the state and the bond count, the
// passkey card appears when a Phone pairs, "Pair new device" makes the board visible, "Forget all" removes the bonds; and the factory reset's
// wipe step (the SDK's c5_wipe, which calls kdrv_ble_unpair) succeeds. As far as the UI allows: the card has no button, so the Dot's Reject
// is exercised in pairing.kodeos-test.mjs.
import { bootBle, check, done, sleep } from "./bench.mjs";

const a = await bootBle("kodeos");
const logs = () => a.logText();
await a.waitFor(() => logs().includes("kgui first frame"), 120000, "kodeOS first frame");
await a.waitFor(() => a.ble.state().adv.on, 30000, "advertising");
await sleep(2500);
const tap = async (x, y, hold = 120) => { a.touch(x, y, true); await sleep(hold); a.touch(x, y, false); await sleep(400); };
const info = async () => { const m = a.mark(); a.type("gui_info"); await a.waitLog(/kgui\s+ble: on=(\w+) adv=(\w+) console=(\w+) bonds=(\d+) pair=(\w+)/, 8000, m); const r = /kgui\s+ble: on=(\w+) adv=(\w+) console=(\w+) bonds=(\d+) pair=(\w+)/.exec(a.logText().slice(m)); return { on: r[1], adv: r[2], console: r[3], bonds: +r[4], pair: r[5] }; };

// control centre -> Bluetooth page (long press on its circle)
for (let y = 10; y <= 460; y += 50) { a.touch(205, y, true); await sleep(25); }
a.touch(205, 470, false);
await sleep(2000);
let m = a.mark();
await tap(205, 94, 1200);
await a.waitLog(/kgui .*ble/i, 5000, m).catch(() => {});
await sleep(1500);
let i = await info();
check(i.on === "on" && i.adv === "on" && i.bonds === 0, "the Bluetooth page: on, visible, no bonds (what a board that knows nobody does)", i);

// a Phone pairs: the card with the code comes up on the glass and goes when it is done
const P = a.ble.addPhone({ name: "Pixel", pairing: "ask" });
check((await P.connect()).ok, "a Phone connects");
const m1 = a.events.length;
const pp = P.pair();
const pk = (await a.waitEvent((e) => e.type === "passkey" && e.id === P.id, 8000, m1)).passkey;
await sleep(800);
m = a.mark();
a.type("gui_info");
await sleep(1500);
check(/kgui\s+pairing: a code is on the glass/.test(logs().slice(m)) && /sheet: pairing/.test(logs().slice(m)), "kodeOS shows the pairing card while the code is live", logs().slice(m).split("\n").filter((l) => /pairing/.test(l)).slice(-3));
P.enterPasskey(pk);
const res = await pp;
check(res.ok && res.authenticated, "the right code pairs", res);
await sleep(2500);
check(/kgui sheet closed: pairing/.test(logs()), "the card closes by itself when the pairing ends");
i = await info();
check(i.bonds === 1, "the page's bond count is 1", i);
await P.disconnect();
await sleep(2500);
i = await info();
check(i.bonds === 1 && i.adv === "off", "bonded: the board is no longer visible to strangers (adv=off in kodeOS's words)", i);

// Pair new device (the row under 'Paired')
m = a.mark();
await tap(170, 428);
await a.waitLog(/pair new device: asked/, 5000, m).catch(() => {});
check(/pair new device: asked/.test(logs().slice(m)), "tapping Pair new device asks AO_Radio to open the door");
await a.waitFor(() => a.ble.state().adv.discoverable, 10000, "visible");
i = await info();
check(i.pair === "on" && i.adv === "on", "the board is visible again for a while", i);
const Q = a.ble.addPhone({ name: "Tablet", pairing: "auto" });
check((await Q.scan(1500)).sees, "a new Phone sees it");
await Q.connect();
await a.waitEvent((e) => e.type === "pairing" && e.id === Q.id, 8000);
await sleep(2000);
i = await info();
check(i.bonds === 2 && Q.bonded, "and pairs: two bonds; the page counts them", i);
await Q.disconnect();
await sleep(1500);

// the page lists Forget all under Pair new device; swipe up to reach it
m = a.mark();
for (let y = 420; y >= 160; y -= 40) { a.touch(205, y, true); await sleep(30); }
a.touch(205, 160, false);
await sleep(800);
let found = false;
for (const y of [330, 380, 430, 300, 260]) {
  await tap(170, y);
  if (/forgetting \d+ bonded peer/.test(logs().slice(m))) { found = true; break; }
}
check(found, "Forget all asks AO_Radio to unpair", logs().slice(m).split("\n").filter((l) => /forget|pair/.test(l)).slice(-4));
await a.waitFor(() => a.ble.state().bonds === 0, 8000, "bonds 0");
check(a.ble.state().bonds === 0 && !a.ble.phones().some((p) => p.connected), "every bond is gone from the Dot's store", a.ble.state().bonds);
i = await info();
check(i.bonds === 0 && i.adv === "on", "the page shows no bonds and the board is visible again", i);

// ---- factory reset's wipe step: c5_wipe confirm=on (vault, BT keys, then kdrv_ble_unpair) ----
const R = a.ble.addPhone({ name: "Reset me", pairing: "auto" });
await R.connect();
await a.waitEvent((e) => e.type === "pairing" && e.id === R.id, 8000);
await R.disconnect();
await sleep(1500);
check(a.ble.state().bonds === 1, "one bond again", a.ble.state().bonds);
m = a.mark();
a.type("c5_wipe confirm=on");
await a.waitLog(/\n>ok|>ok/, 15000, m).catch(() => {});
await sleep(1000);
const t = logs().slice(m);
check(!/c5_wipe.*(vault|btkeys|ble)\b.*(err|fail)/i.test(t) && a.ble.state().bonds === 0, "c5_wipe succeeded and the BLE step removed the bond (kdrv_ble_unpair)", t.split("\n").filter((l) => /wipe|ok|err/.test(l)).slice(-5));
check(a.stubLines().filter((l) => /kdrv_ble/.test(l)).length === 0, "no BLE stub was hit");
done(a, "kodeOS BLE page");
