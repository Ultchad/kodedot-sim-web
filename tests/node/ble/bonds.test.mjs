// Bonds: kept in a persisted region, they survive a restart of the device, are seen by the SDK's own ble_info verb, and are removed by the
// SDK's own ble_unpair verb; a Phone that kept its side of a bond the Dot no longer has is refused at encryption.
import { bootBle, check, done, sleep } from "./bench.mjs";

let a = await bootBle("ble_peripheral");
await a.waitFor(() => /advertising as 'Kode BLE demo'/.test(a.logText()), 20000, "advertising");
const phone = a.ble.addPhone({ name: "Pixel" });
a.ble.bondPhone(phone);
check(a.ble.state().bonds === 1, "one bond planted", a.ble.state().bonds);
const bondLtk = phone.bond.ltk;
await sleep(300);
a.type("ble_info");
await a.waitLog(/bonds?[ =:]+1|1 bond/i, 8000).catch(() => {});
console.log("     ble_info says: " + a.logText().split("\n").filter((l) => /ble_info|bond/i.test(l)).slice(-3).join(" | ").slice(0, 300));
const bondsAtRestart = a.ble.state().bondList;

// ---- restart: the region persists, the page's Phone object persists in the blob ----
const objs = a.ble.phones().map((p) => p.def());
a = await a.restart();
await a.waitFor(() => /advertising as 'Kode BLE demo'/.test(a.logText()), 20000, "advertising after restart");
check(a.ble.state().bonds === 1, "after a restart the Dot still has the bond", a.ble.state().bonds);
check(JSON.stringify(a.ble.state().bondList.map((b) => b.addr)) === JSON.stringify(bondsAtRestart.map((b) => b.addr)), "it is the same bond", a.ble.state().bondList);
const again = a.ble.phones();
check(again.length === 1 && again[0].bond?.ltk === bondLtk && again[0].name === "Pixel", "the Phone object and its key came back from the saved objects", again.map((p) => p.def()));
const p2 = again[0];
check((await p2.connect()).ok && await p2.whenSecure(4000), "the Phone reconnects with its key after the restart");
check(a.ble.state().secure, "the Dot says the link is secure");

// ---- ble_unpair: the SDK refuses it only while the console is attached; a plain connection does not stop it ----
await p2.disconnect();
await sleep(500);
a.type("ble_unpair");
await a.waitFor(() => a.ble.state().bonds === 0, 8000, "bonds 0");
check(a.ble.state().bonds === 0, "ble_unpair removed the bond", a.ble.state().bonds);

// ---- the Phone still holds its side: encryption fails, the Dot hangs up ----
await a.waitFor(() => a.ble.state().adv.on, 10000, "advertising");
const c = await p2.connect();
check(c.ok, "the Phone with a stale bond can connect");
const secure = await p2.whenSecure(2500);
check(!secure, "but its key is unknown to the Dot: no encryption");
await a.waitFor(() => !p2.connected, 5000, "hung up");
check(!p2.connected && /encryption failed \(status 518\)/.test(a.logText()), "the Dot logs the failed encryption and hangs up", a.logText().split("\n").filter((l) => /encryption/.test(l)).slice(-2));
p2.forget();
check(!p2.bonded, "the Phone can forget its side");

// ---- a bond made with the wrong key: MIC failure, the Dot's bond stays ----
const p3 = a.ble.addPhone({ name: "Tablet" });
a.ble.bondPhone(p3);
p3.bond.ltk = "ff".repeat(16);
await a.waitFor(() => a.ble.state().adv.on, 10000, "advertising");
await p3.connect();
check(!(await p3.whenSecure(2500)), "a wrong key never encrypts");
check(/status 573/.test(a.logText()) && a.ble.state().bonds === 1, "the Dot says so (MIC failure) and keeps the real bond", a.ble.state().bonds);

// ---- the store holds three: a fourth planted bond is refused in an app ----
const ps = [a.ble.addPhone({ name: "A" }), a.ble.addPhone({ name: "B" }), a.ble.addPhone({ name: "C" })];
const planted = ps.map((p) => a.ble.bondPhone(p));
check(planted.join() === "true,true,false" && a.ble.state().bonds === 3, "the store holds three bonds, a fourth is refused", planted);
check(a.stubLines().length === 0, "no 'not implemented' stub was hit", a.stubLines().slice(0, 3));
done(a, "bonds");
