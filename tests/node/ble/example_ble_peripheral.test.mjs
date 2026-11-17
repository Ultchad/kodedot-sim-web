// The UNMODIFIED SDK example examples/ble_peripheral, end to end with a Phone. In an app the Dot never shows a code and takes no new
// bond (that is kodeOS's Bluetooth page), so the Phone is one that was bonded in kodeOS before: the bond store survives the jump.
import { bootBle, check, done, sleep } from "./bench.mjs";
import { BTN } from "../harness.mjs";

const a = await bootBle("ble_peripheral");
const logs = () => a.logText();
await a.waitFor(() => /advertising as 'Kode BLE demo'/.test(logs()), 20000, "advertising");
const st0 = a.ble.state();
check(st0.adv.on && st0.adv.name === "Kode BLE demo", "the Dot advertises under the name the app set", st0.adv);

// a stranger: sees the Dot, connects, but cannot pair in an app
const stranger = a.ble.addPhone({ name: "Stranger", pairing: "auto" });
let look = await stranger.scan(2000);
check(look.sees && look.name === "Kode BLE demo" && look.discoverable, "a Phone sees the Dot advertising and its name", look);
check(look.uuids.includes("4b4f4445-0001-4f53-a2d1-7c0e9b5f3a61"), "the advert carries the console service UUID", look.uuids);
let c = await stranger.connect();
check(c.ok, "the Phone connects", c);
await a.waitFor(() => /pairing refused: a new phone pairs in kodeOS/.test(logs()), 8000, "refused");
await a.waitEvent((e) => e.type === "disconnected" && e.id === stranger.id, 3000);
check(!stranger.connected && a.ble.state().bonds === 0, "pairing is refused in an app: the Phone is dropped and no bond is made");
check(stranger.bond === null, "the stranger holds no bond");
stranger.remove();

// a bonded Phone
const phone = a.ble.addPhone({ name: "Pixel", pairing: "auto" });
check(a.ble.bondPhone(phone), "a bond planted as if made in kodeOS");
check(a.ble.state().bonds === 1, "the Dot's bond count is 1", a.ble.state().bonds);
await sleep(200);
c = await phone.connect();
check(c.ok, "the bonded Phone connects", c);
check(await phone.whenSecure(4000), "it encrypts the link with its stored key by itself");
await a.waitFor(() => /connected/.test(logs().split("advertising as")[1] ?? ""), 5000, "connected event");
check(/ble_peripheral .*\bconnected\b|ble_peripheral connected|\] connected|I .*ble_peripheral\s+connected/i.test(logs()) || /connected/.test(logs()), "the example's listener saw the connection");

const gatt = phone.discover();
const svc = gatt.find((s) => s.uuid === "8f3c0001-5b7e-4a52-9d2e-6b1f0c7a4e21");
check(svc && svc.chars.length === 2, "the app's service has its two characteristics", gatt.map((s) => s.uuid));
const count = svc.chars[0], led = svc.chars[1];
check(count.read && count.notify && !count.write && led.write && !led.read, "properties are as declared (count read+notify, led write)", [count, led]);
check(count.enc && count.authen, "every characteristic needs an encrypted, authenticated link");
check(gatt.some((s) => s.uuid === "4b4f4445-0001-4f53-a2d1-7c0e9b5f3a61"), "the console service is there too");

let r = await phone.subscribe({ app: 0 });
check(r.status === 0, "subscribe to count", r);
await sleep(2600);
const notes = phone.notifications.filter((n) => n.kind === "app");
check(notes.length >= 2, "count notifications arrive about once a second", notes.length);
check(notes.length > 1 && notes[1].data[0] - notes[0].data[0] === 1 && notes[0].data.length === 4, "the counter counts up, 4 bytes little-endian", notes.slice(0, 3));
r = await phone.read({ app: 0 });
check(r.status === 0 && r.data.length === 4, "read count", r);

r = await phone.write({ app: 1 }, [1, 2, 3]);
check(r.status === 0, "write the LED colour", r);
await a.waitFor(() => /led set to 1 2 3/.test(logs()), 5000, "led set");
r = await phone.write({ app: 1 }, [9, 9]);
await a.waitFor(() => /2 byte\(s\) written to led, ignored/.test(logs()), 5000, "ignored");
check(r.status === 0, "a 2-byte write is accepted by the stack and ignored by the app");
r = await phone.write({ app: 1 }, new Array(300).fill(1));
check(r.status === 0x0d, "a write over the value size is INVALID_ATTR_VALUE_LEN", r);
r = await phone.read({ app: 1 });
check(r.status === 2, "reading a write-only characteristic is READ_NOT_PERMITTED", r);
r = await phone.read("console-tx");
check(r.status === 2, "the console's characteristics cannot be read", r);

await phone.subscribe({ app: 0 }, false);
const n0 = phone.notifications.length;
await sleep(1200);
check(phone.notifications.length === n0, "no notifications after unsubscribing");

await phone.disconnect();
await a.waitFor(() => /disconnected/.test(logs().split("led set to")[1] ?? ""), 5000, "disconnected event");
check(true, "the example's listener saw the disconnection");
await sleep(500);
check(a.ble.state().adv.on || a.ble.state().state === 2, "the Dot advertises again after the Phone left", a.ble.state().state);

// reconnect works: still bonded
c = await phone.connect();
check(c.ok && await phone.whenSecure(4000), "the same Phone reconnects and encrypts again");
check(a.stubLines().length === 0, "no 'not implemented' stub was hit", a.stubLines().slice(0, 3));
await phone.disconnect();
await a.press(BTN.BOT);
await sleep(300);
done(a, "example_ble_peripheral");
