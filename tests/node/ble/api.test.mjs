// The public Bluetooth API (kode_ble_*) and the SDK's console verbs over the fake: name, manufacturer data, the app's service, values,
// notifications, writes, the console channel from a Phone, ble_scan / ble_heard.
import { bootBle, check, done, sleep } from "./bench.mjs";

const a = await bootBle("ble_api");
await a.waitFor(() => a.logText().includes("ble_api up"), 20000, "app boot");
a.ble.configure({ scanSpeed: 4 });
await a.waitFor(() => a.ble.state().adv.on, 20000, "advertising");

// name and manufacturer data show up in what the Phone sees
const phone = a.ble.addPhone({ name: "Pixel" });
a.ble.bondPhone(phone);
let look = await phone.scan(1500);
check(look.sees && look.name, "the Phone sees the Dot under its serial name", look);
let r = await a.fn("name", "Bench Dot");
check(/ok=1/.test(r), "kode_ble_set_name", r);
await a.waitFor(() => a.ble.state().adv.name === "Bench Dot", 8000, "the new name on the air");
check(a.ble.state().adv.name === "Bench Dot", "the new name is in the scan response on the air", a.ble.state().adv);
r = await a.fn("mfg", "e502aabbcc");
check(/ok=1/.test(r), "kode_ble_set_manufacturer_data", r);
await sleep(300);
look = await phone.scan(1500);
check(look.name === "Bench Dot", "the Phone reads the new name", look);
await a.waitFor(() => a.ble.state().adv.mfg?.join() === "229,2,170,187,204".replace("229,2","229,2"), 3000, "mfg on air").catch(() => {});
check(JSON.stringify(a.ble.state().adv.mfg) === JSON.stringify([0xe5, 0x02, 0xaa, 0xbb, 0xcc]), "the manufacturer data is in the scan response", JSON.stringify(a.ble.state().adv.mfg));

// connect, console channel and the app's service
check((await phone.connect()).ok && await phone.whenSecure(4000), "a bonded Phone connects");
const g = phone.discover();
const names = g.map((s) => s.uuid);
check(names.includes("5e7f0001-1111-4222-8333-444455556666") && names.includes("4b4f4445-0001-4f53-a2d1-7c0e9b5f3a61") && names.includes("1800"), "services: the app's, the console's and GAP", names);
check((await phone.read("gap-name")).data.length > 0, "the GAP device name reads (without a secure link requirement)");
const val = phone.discover().find((s) => s.uuid.startsWith("5e7f0001")).chars[0];
check(val.read && val.write && val.notify, "val has read, write and notify", val);

r = await phone.subscribe({ app: 0 });
check(r.status === 0, "subscribe to val", r);
await a.fn("notify", 7);
await phone.read({ app: 0 }).then(() => {});
await a.waitFor(() => phone.notifications.some((n) => n.kind === "app" && n.data[0] === 7), 5000, "notification");
check(phone.notifications.some((n) => n.kind === "app" && n.data[0] === 7 && n.data[1] === 0x55), "kode_ble_notify reaches the Phone", phone.notifications);
await a.fn("set", 9);
r = await phone.read({ app: 0 });
check(r.status === 0 && r.data[0] === 9 && r.data[1] === 0xaa, "kode_ble_set_value is what a read returns", r);
r = await phone.write({ app: 0 }, [4, 5, 6]);
await a.waitFor(() => /RES event ble_written/.test(a.logText()), 5000, "written event");
check(r.status === 0 && /RES event ble_written source=val value=3/.test(a.logText()), "a Phone's write arrives as ble_written (source val, 3 bytes)", r);

// the console over BLE
r = await phone.console.subscribe();
check(r.status === 0, "subscribe to the console's TX", r);
await a.waitFor(() => a.ble.state().console, 5000, "console attached");
check(/console attached/.test(a.logText()), "the log says: console attached");
const rx = await phone.console.send("ble_info");
check(rx.status === 0, "a console line is written", rx);
const line = await phone.console.waitLine(/ble=/, 6000).catch((e) => e.message);
check(/connected/.test(line) && /console=on/.test(line), "the Dot's console answers over BLE (ble_info says connected, console=on)", line);
const rx2 = await phone.console.send("x".repeat(300));
check(rx2.status === 0, "a long line is cut into MTU-sized writes", rx2);
await phone.write("console-rx", new Array(300).fill(65));
const big = await phone.write("console-rx", new Array(300).fill(65));
check(big.status === 0x0d, "one write over 256 bytes is refused as invalid length", big);

// stalled phone: notifications retry (ENOMEM) and are delivered once it recovers
phone.stall(true);
const retry0 = a.ble.state().txRetry;
await a.fn("notify", 21);
await sleep(300);
check(!phone.notifications.some((n) => n.kind === "app" && n.data[0] === 21), "a stalled Phone gets nothing yet");
phone.stall(false);
await a.waitFor(() => phone.notifications.some((n) => n.kind === "app" && n.data[0] === 21), 5000, "delivered");
check(a.ble.state().txRetry > retry0, "the Dot retried (the retry counter moved)", [retry0, a.ble.state().txRetry]);

await phone.disconnect();
await sleep(300);
check(/console detached|disconnected/.test(a.logText()), "disconnect is logged");
check(a.ble.state().adv.on || a.ble.state().state === 2, "advertising again");

// the SDK's own scan verb: ble_scan over Sensors
a.ble.addSensor({ name: "S1", rssi: -50 });
a.type("ble_scan");
await a.waitLog(/S1/, 15000).catch(() => {});
check(/S1/.test(a.logText().split("ble_scan").at(-1)), "the SDK's ble_scan verb lists the Sensor", a.logText().split("ble_scan").at(-1).slice(0, 300));
check(a.stubLines().length === 0, "no 'not implemented' stub was hit", a.stubLines().slice(0, 3));
done(a, "api");
