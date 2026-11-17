// BLE follows the radio core: the C5 powered off or its link dropped takes the connection, the advert and any scan with it; when the link
// comes back the SDK's AO_Radio brings Bluetooth up again as the user left it, and a bonded Phone is back in a moment.
import { bootBle, check, done, sleep } from "./bench.mjs";

const a = await bootBle("ble_peripheral");
const logs = () => a.logText();
await a.waitFor(() => /advertising as 'Kode BLE demo'/.test(logs()), 20000, "advertising");
const phone = a.ble.addPhone({ name: "Pixel" });
a.ble.bondPhone(phone);
check((await phone.connect()).ok && await phone.whenSecure(4000), "a bonded Phone is connected and encrypted");
await phone.subscribe({ app: 0 });
await sleep(1200);
const n0 = phone.notifications.length;
check(n0 >= 1, "notifications flow", n0);

// ---- the C5 loses power ----
let m = a.mark();
a.radio.setPower(false);
await a.waitEvent((e) => e.type === "disconnected" && e.id === phone.id, 8000);
check(!phone.connected, "power off: the connection is gone");
await sleep(600);
let st = a.ble.state();
check(!st.adv.on && !st.scan.on, "power off: nothing is advertising", st);
const stranger = a.ble.addPhone({ name: "Other" });
const look = await stranger.scan(400);
check(!look.sees, "power off: a Phone does not see the Dot", look);
const c = await stranger.connect({ wait: 300 });
check(!c.ok, "power off: connecting fails", c);
check(a.ble.info().bonds === 1, "the bond survives the power cut (it is in the Dot's own store)", a.ble.info().bonds);
check(a.ble.info().up === 0 || a.ble.info().synced === 0, "the Dot's host is down or unsynced with the radio off", a.ble.info());

// ---- power back ----
m = a.mark();
a.radio.setPower(true);
await a.waitFor(() => a.ble.state().adv.on, 30000, "advertising again");
check(true, "power on: the Dot advertises again by itself");
const look2 = await stranger.scan(2000);
check(look2.sees && look2.name === "Kode BLE demo", "a Phone sees it under the same name", look2);
check((await phone.connect()).ok && await phone.whenSecure(4000), "the bonded Phone reconnects and encrypts after the radio came back");
await phone.subscribe({ app: 0 });
const n1 = phone.notifications.length;
await sleep(1500);
check(phone.notifications.length > n1, "notifications flow again");

// ---- the link drops (not the power): same ----
a.radio.dropLink();
await a.waitEvent((e) => e.type === "disconnected" && e.id === phone.id, 8000, 0).catch(() => {});
await a.waitFor(() => !phone.connected, 8000, "dropped");
check(!phone.connected, "link drop: the connection is gone");
await a.waitFor(() => a.ble.state().adv.on, 30000, "advertising after the link came back");
check(true, "link drop: advertising resumes when the link is back");
check(a.stubLines().length === 0, "no 'not implemented' stub was hit", a.stubLines().slice(0, 3));
done(a, "radio_power");
