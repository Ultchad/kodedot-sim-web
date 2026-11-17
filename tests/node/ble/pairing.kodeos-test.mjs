// kodeOS (role kodeos) over the BLE area: pairing as the SDK models it (a passkey shown on the Dot, entered on the phone), bonds, the Dot
// hiding from strangers once it has a bond, "Pair new device" (the SDK's ble_pair verb) opening the door, wrong passkeys, refusals, the
// 30 s security-manager timeout, the third-bond eviction, and unpair.
import { bootBle, check, done, sleep } from "./bench.mjs";

const a = await bootBle("kodeos");
const logs = () => a.logText();
await a.waitFor(() => logs().includes("kgui first frame"), 120000, "kodeOS first frame");
await a.waitFor(() => a.ble.state().adv.on, 30000, "advertising");
a.ble.configure({ smTimeoutMs: 4000 });
const missing = logs().split("\n").filter((l) => /dotbench: kdrv_ble\w* not implemented/.test(l));
check(missing.length === 0, "no kdrv_ble_* function is a stub in kodeOS", missing);
check(a.ble.state().adv.discoverable, "a board that knows nobody is visible", a.ble.state().adv);

// ---- phone A pairs: the passkey is shown, A types it ----
const A = a.ble.addPhone({ name: "Alice's phone", pairing: "auto" });
let look = await A.scan(1500);
check(look.sees && look.discoverable, "A sees the Dot", look);
check((await A.connect()).ok, "A connects");
const ev = await a.waitEvent((e) => e.type === "passkey" && e.id === A.id, 8000);
check(/^\d{1,6}$/.test(String(ev.passkey)) && ev.passkey === a.ble.lastPasskey(), "the Dot shows a six digit code (the bench mirrors it)", ev);
check(/pairing: a code is on the screen/.test(logs()), "the SDK logged: a code is on the screen");
const done1 = await a.waitEvent((e) => e.type === "pairing" && e.id === A.id, 8000);
check(done1.ok && done1.authenticated, "the passkey was accepted: authenticated pairing", done1);
check(a.ble.state().bonds === 1 && A.bonded && A.secure, "a bond exists on both sides and the link is encrypted", a.ble.state().bonds);
check(a.ble.state().secure, "the Dot reports the link secure (kdrv_ble_link_secure)");
check(/bonded/.test(logs()), "the SDK logged 'bonded'");
const gatt = A.discover();
check(gatt.some((s) => s.chars.some((c) => c.kind === "console-tx")) && gatt.some((s) => s.chars.some((c) => c.kind === "mirror")), "kodeOS exposes the console and the mirror characteristics", gatt.map((s) => s.uuid));

// ---- the console over BLE, now that A is bonded ----
check((await A.console.subscribe()).status === 0, "A subscribes to the console");
await A.console.send("ble_info");
const l1 = await A.console.waitLine(/ble=connected/, 6000).catch((e) => e.message);
check(/bonds=1/.test(l1) && /console=on/.test(l1), "ble_info over BLE: connected, console on, one bond", l1);
check((await A.mirror.subscribe()).status === 0, "A subscribes to the mirror pipe");
await a.waitFor(() => a.ble.state().mirror, 4000, "mirror attached");
check(a.ble.state().mirror && /mirror attached/.test(logs()), "the mirror pipe is attached");

// ---- hidden from strangers once bonded ----
await A.disconnect();
await sleep(800);
const B = a.ble.addPhone({ name: "Bob's phone", pairing: "auto" });
await a.waitFor(() => a.ble.state().adv.on, 15000, "advertising after A left");
look = await B.scan(1200);
check(!look.sees && look.hidden, "a board with a bond hides from a phone it does not know", look);
check(!(await B.connect({ wait: 300 })).ok, "B cannot connect to a hidden Dot");
look = await A.scan(1200);
check(look.sees && look.bonded && !look.discoverable, "but the bonded phone still finds it (hidden, no name)", look);
check((await A.connect()).ok && await A.whenSecure(4000), "A reconnects and encrypts with its key, no passkey needed");
await A.disconnect();

// ---- Pair new device: the SDK's ble_pair verb makes it visible ----
a.type("ble_pair");
await a.waitFor(() => a.ble.state().adv.discoverable, 15000, "visible");
await sleep(300);
look = await B.scan(1500);
check(look.sees && look.discoverable && look.name, "Pair new device: B sees the Dot", look);

// wrong passkey
check((await B.connect()).ok, "B connects");
const shown = (await a.waitEvent((e) => e.type === "passkey" && e.id === B.id, 8000)).passkey;
// "auto" typed the right code already; so first let this one run out and look at the outcome
const r1 = await a.waitEvent((e) => e.type === "pairing" && e.id === B.id, 8000);
check(r1.ok && a.ble.state().bonds === 2, "B (auto) paired with the right code: two bonds", r1);
await B.disconnect();
await sleep(500);

const C = a.ble.addPhone({ name: "Carol", pairing: "ask" });
a.type("ble_pair");
await a.waitFor(() => a.ble.state().adv.discoverable, 15000, "visible again");
await sleep(300);
check((await C.connect()).ok, "C connects");
check(!C.pairResolve && !C.secure, "an 'ask' phone does not pair by itself: the user has to press Pair");
const m0 = a.events.length;
const cp = C.pair();
let pk = (await a.waitEvent((e) => e.type === "passkey" && e.id === C.id, 8000, m0)).passkey;
let res = await Promise.race([cp, sleep(200).then(() => "waiting")]);
check(res === "waiting", "it waits for the user to type the code the Dot shows");
C.enterPasskey((pk + 1) % 1000000);
res = await cp;
check(!res.ok && res.status === 0x401, "a wrong passkey fails the pairing (status 0x401)", res);
check(a.ble.state().bonds === 2 && !C.bonded, "no bond was made", a.ble.state().bonds);
check(/encryption failed \(status 1025\)/.test(logs()), "the SDK logged the failed encryption");
await a.waitFor(() => !C.connected, 4000, "hung up");
check(!C.connected, "the Dot hangs up on a failed pairing");

// the phone's user cancels
a.type("ble_pair");
await a.waitFor(() => a.ble.state().adv.discoverable, 15000, "visible again");
await sleep(300);
await C.connect();
res = await C.pair({ accept: false });
check(!res.ok, "a phone whose user cancels does not pair", res);
await a.waitFor(() => !C.connected, 4000, "hung up");

// time out: nobody types
a.type("ble_pair");
await a.waitFor(() => a.ble.state().adv.discoverable, 15000, "visible again");
await sleep(300);
await C.connect();
const t0 = Date.now();
res = await C.pair();
check(!res.ok && res.status === 13 && Date.now() - t0 >= 3500, "no passkey in the security manager's time: it gives up (status 13)", res);
check(a.ble.state().bonds === 2, "still two bonds");

// ---- the third bond, then the fourth evicts the oldest ----
const D = a.ble.addPhone({ name: "Dan", pairing: "auto" });
a.type("ble_pair");
await a.waitFor(() => a.ble.state().adv.discoverable, 15000, "visible");
await sleep(300);
await D.connect();
await a.waitEvent((e) => e.type === "pairing" && e.id === D.id, 8000);
check(a.ble.state().bonds === 3, "three bonds", a.ble.state().bonds);
const oldest = a.ble.state().bondList.sort((x, y) => x.seq - y.seq)[0].addr;
await D.disconnect();
const E = a.ble.addPhone({ name: "Eve", pairing: "auto" });
a.type("ble_pair");
await a.waitFor(() => a.ble.state().adv.discoverable, 15000, "visible");
await sleep(300);
await E.connect();
await a.waitEvent((e) => e.type === "pairing" && e.id === E.id, 8000);
const left = a.ble.state().bondList.map((b) => b.addr);
check(a.ble.state().bonds === 3 && !left.includes(oldest), "a fourth bond evicts the oldest (round-robin), three remain", left);
await E.disconnect();

// ---- the Dot refuses: the kodeOS reject button ----
const F = a.ble.addPhone({ name: "Fay", pairing: "ask" });
a.type("ble_pair");
await a.waitFor(() => a.ble.state().adv.discoverable, 15000, "visible");
await sleep(300);
await F.connect();
const m1 = a.events.length;
F.pair();
await a.waitEvent((e) => e.type === "passkey" && e.id === F.id, 8000, m1);
a.ctx.call("ble_test_pair_reject");
await a.waitFor(() => !F.connected, 4000, "hung up");
check(/pairing refused here/.test(logs()) && !F.connected && a.ble.state().bonds === 3, "the Dot's Reject hangs up and makes no bond");

// ---- unpair ----
a.type("ble_unpair");
await a.waitFor(() => a.ble.state().bonds === 0, 8000, "bonds 0");
check(a.ble.state().bonds === 0, "ble_unpair forgets every bond", a.ble.state().bonds);
await sleep(500);
check(a.ble.state().adv.discoverable, "a board that knows nobody is visible again");
check(a.stubLines().filter((l) => /kdrv_ble/.test(l)).length === 0, "no BLE stub was hit");
done(a, "kodeOS BLE pairing");
