import { bootBle, check, done, sleep } from "./bench.mjs";
const a = await bootBle("ble_peripheral");
await sleep(6000);
console.log(a.logText().split("\n").filter((l)=>/ble|BLE|kdrv|advert/i.test(l)).slice(0,40).join("\n"));
console.log(JSON.stringify(a.ble.state()));
done(a, "probe");
