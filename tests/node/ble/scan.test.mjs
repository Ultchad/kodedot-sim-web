// Scanning with Sensors: the SDK's kode_ble_scan (the real AO_Radio, kdrv_ble_scan_* rules) over bench Sensors.
import { bootBle, check, done, sleep } from "./bench.mjs";

const a = await bootBle("ble_api");
await a.waitFor(() => a.logText().includes("ble_api up"), 20000, "app boot");
a.ble.configure({ scanSpeed: 4 });
await sleep(1500);

const s1 = a.ble.addSensor({ name: "Kitchen", rssi: -58, temperature: 21.5 });
const s2 = a.ble.addSensor({ name: "Garage", rssi: -81, nameIn: "rsp", mfg: "e5020a0b", services: [0x181a] });
const s3 = a.ble.addSensor({ name: "Far away", rssi: -70, inRange: false });

let r = await a.scan(1000);
if (r.n < 0) { await sleep(2500); r = await a.scan(1000); }   // the first listen after the link came up can be refused busy
check(r.n === 2 && r.devs.length === 2, "two Sensors in range are heard, the out-of-range one is not", r);
check(r.devs[0]?.name === "Kitchen" && r.devs[0].rssi === -58, "the strongest first, with name and RSSI", r.devs[0]);
check(r.devs[1]?.name === "Garage" && r.devs[1].rssi === -81, "a name carried only in the scan response is found (active scan)", r.devs[1]);
check(r.devs[0]?.addr === s1.address, "the address is the Sensor's", r.devs[0]);

s3.update({ inRange: true });
s1.update({ rssi: -90 });
r = await a.scan(1000);
check(r.n === 3, "a Sensor that comes into range is heard", r);
check(r.devs.map((d) => d.name).join() === "Far away,Garage,Kitchen", "RSSI ordering follows the new readings", r.devs);

s2.update({ inRange: false }); s3.remove();
r = await a.scan(1000);
check(r.n === 1 && r.devs[0].name === "Kitchen", "removed and out-of-range Sensors disappear", r);
check(a.ble.state().stack.up, "the stack is up");

// advert size rules
let threw = false;
try { s1.update({ name: "A name that is much too long for an advertisement indeed" }); } catch { threw = true; }
check(threw && s1.name === "Kitchen", "an advertisement that cannot fit is refused and the Sensor keeps its old state");
check(a.stubLines().length === 0, "no 'not implemented' stub was hit", a.stubLines().slice(0, 3));
done(a, "scan");
