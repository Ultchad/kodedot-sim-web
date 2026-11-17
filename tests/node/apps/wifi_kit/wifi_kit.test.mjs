// Wi-Fi: scan (signal bars, lock, channel), network details, join open and WPA2 networks, wrong password, out of range, no internet,
// hidden network, status with the address, disconnect, and the router/internet check, against bench routers.
import assert from "node:assert/strict";
import * as radioGlue from "../../../../runtime/drivers/radio/radio.js";
import * as wifiGlue from "../../../../runtime/drivers/wifi/wifi.js";
import * as netGlue from "../../../../runtime/drivers/net/net.js";
import { Bench, launch, build, runner, sleep, BTN, storeShots, typeText, tapPage } from "../lib.mjs";

const T = runner("wifi_kit");
const pkg = build("wifi_kit");
const bench = await new Bench().open();
const app = await launch(bench, pkg, { name: "wifi_kit", glue: { radio: radioGlue, wifi: wifiGlue, net: netGlue } });
app.glue.radio.fastTiming?.();
const W = app.glue.wifi;
const home = W.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40 });
const five = W.addRouter({ ssid: "Home5G", password: "hunter22", channel: 149, signal: -52, security: "wpa2/wpa3" });
const cafe = W.addRouter({ ssid: "Cafe", channel: 1, signal: -61, security: "open" });
const farr = W.addRouter({ ssid: "Faraway", password: "farfarfar", channel: 11, signal: -80 });
const ROW = [116, 208, 300, 392];
const BTN_Y = 432, LEFT_X = 114, RIGHT_X = 296;
const logs = () => app.log();
const lit = (x, y) => app.px(x, y) !== 0;
const station = () => W.station();
const count = (re) => (logs().match(re) || []).length;

await app.waitFor(() => logs().includes("wifi.ao up"), 30000, "boot");
await app.waitFor(() => app.run.frameSeq() > 0, 30000, "first frame");
await app.settle(600);

/** Open Networks and wait for the sweep to finish. */
async function scan() {
  const n = count(/scan ended/g);
  await app.tap(205, ROW[0]);
  await app.settle(300);
  await app.waitFor(() => count(/scan ended/g) > n, 40000, "the sweep to end");
  await app.settle(800);
}
const home_ = async () => { for (let i = 0; i < 6 && !(lit(100, ROW[0]) && app.px(205, 8) === 0 && !lit(205, BTN_Y)); i++) { await app.press(BTN.BOT); await app.settle(500); } };

await T.check("boots to Networks, Status and Check connection", async () => {
  await app.shot("home");
  assert.ok(app.stats().colours > 20 && lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]));
});

await T.check("Networks waits for the sweep, then lists what it heard strongest first with a lock for secured ones", async () => {
  await app.tap(205, ROW[0]);
  await app.settle(300);
  await app.shot("scanning");
  await app.waitFor(() => count(/scan ended: \d+ networks/g) > 0, 40000, "the sweep to end");
  await app.settle(800);
  await app.shot("networks");
  assert.ok(/scan ended: 4 networks/.test(logs()), "four routers heard");
  assert.ok(lit(100, ROW[0]) && lit(100, ROW[1]) && lit(100, ROW[2]) && lit(100, ROW[3]));
});

await T.check("A network's page shows security, channel and signal", async () => {
  await app.tap(205, ROW[0]);              // Home: strongest
  await app.settle(700);
  await app.shot("network");
  assert.ok(lit(205, BTN_Y));
});

await T.check("A wrong password is said plainly; Try again keeps the keypad and the right one joins", async () => {
  await app.tap(205, BTN_Y);               // Connect
  await app.settle(700);
  await app.shot("password-empty");
  await typeText(app, "wrongpass");
  await app.shot("password-typed");
  await app.tap(205, BTN_Y);               // Join
  await app.settle(500);
  await app.waitFor(() => /refused us/.test(logs()) && count(/wifi state 3 '[^']*' fail [1-4] joining 0/g) > 0, 20000, "the refusal");
  await app.settle(900);
  await app.shot("wrong-password");
  assert.equal(station().connected, null);
  await app.tap(205, BTN_Y);               // Try again: the keypad, with the old text
  await app.settle(700);
  await typeText(app, "", 9);
  await typeText(app, "hunter22");
  await app.tap(205, BTN_Y);
  await app.waitFor(() => station().connected?.ssid === "Home", 20000, "joined Home");
  await app.settle(900);
  await app.shot("connected");
  assert.equal(station().connected.ip, home.ip);
});

await T.check("Done shows the status with the address and the signal", async () => {
  await app.tap(205, BTN_Y);               // Done
  await app.settle(900);
  await app.shot("status");
  assert.ok(lit(LEFT_X, BTN_Y) && lit(RIGHT_X, BTN_Y), "Check and Disconnect");
});

await T.check("Check connection: the router answers, the internet does not on a router without it", async () => {
  home.update({ internet: false });
  await app.tap(LEFT_X, BTN_Y);            // Check
  await app.settle(500);
  await app.shot("check-running");
  await app.waitFor(() => /ping stage 2: rc/.test(logs()), 30000, "both pings");
  await app.settle(900);
  await app.shot("check-no-internet");
  const l = logs();
  assert.ok(/ping stage 1: rc 0, 3 of 3/.test(l), "router: 3 of 3");
  assert.ok(/ping stage 2: rc 0, 0 of 3/.test(l), "internet: none");
});

await T.check("With a host the router can reach, both checks pass", async () => {
  home.host("one.test", { ip: "1.1.1.1", routes: { "*": { body: "" } } });
  await app.tap(205, BTN_Y);               // Again
  await app.settle(500);
  const n = count(/ping stage 2: rc 0, 3 of 3/g);
  await app.waitFor(() => count(/ping stage 2: rc 0, 3 of 3/g) > n, 30000, "internet answers");
  await app.settle(900);
  await app.shot("check-ok");
});

await T.check("Disconnect leaves the network; Status says so", async () => {
  await app.press(BTN.BOT); await app.settle(700);
  await app.tap(RIGHT_X, BTN_Y);           // Disconnect
  await app.waitFor(() => station().connected === null, 15000, "left");
  await app.settle(1200);
  await app.shot("not-connected");
  assert.ok(lit(205, BTN_Y));
  await app.press(BTN.BOT); await app.settle(700);
});

await T.check("An open network joins with one tap and no password", async () => {
  await scan();
  await app.tap(205, ROW[2]);              // Cafe (third by strength)
  await app.settle(700);
  await app.shot("network-open");
  await app.tap(205, BTN_Y);
  await app.waitFor(() => station().connected?.ssid === "Cafe", 20000, "joined Cafe");
  await app.settle(900);
  assert.equal(station().connected.ip, cafe.ip);
  await app.tap(205, BTN_Y);               // Done -> Status
  await app.settle(900);
});

await T.check("The Networks list marks the network the Dot is on, and its page offers Disconnect", async () => {
  await app.press(BTN.BOT); await app.settle(600);
  await scan();
  await app.shot("networks-connected");
  await app.tap(205, ROW[2]);
  await app.settle(700);
  await app.shot("network-connected");
  assert.ok(lit(LEFT_X, BTN_Y) && lit(RIGHT_X, BTN_Y));
  await app.tap(RIGHT_X, BTN_Y);           // Disconnect
  await app.waitFor(() => station().connected === null, 15000, "left");
  await app.settle(800);
});

await T.check("A network that went out of range is 'not found'", async () => {
  await app.tap(205, ROW[0]);              // Home
  await app.settle(700);
  farr.remove();
  home.setInRange(false);
  await app.tap(205, BTN_Y);               // Connect
  await app.settle(700);
  await typeText(app, "hunterhunter");
  await app.tap(205, BTN_Y);
  await app.waitFor(() => /wifi state \d+ '[^']*' fail 2 joining 0/.test(logs()), 30000, "not found");
  await app.settle(900);
  await app.shot("not-found");
  assert.equal(station().connected, null);
  home.setInRange(true);
});

await T.check("A hidden network asks for its name, then its password", async () => {
  for (let i = 0; i < 3; i++) { await app.press(BTN.BOT); await app.settle(700); }
  const hid = W.addRouter({ ssid: "Secret", password: "hidehide9", channel: 11, signal: -45, hidden: true, security: "wpa3" });
  await scan();
  await app.shot("networks-hidden");
  await app.tap(205, ROW[1]);              // Hidden, second by strength (-45 dBm)
  await app.settle(700);
  await app.shot("network-hidden");
  await tapPage(app, 205, BTN_Y);          // Connect
  await app.shot("hidden-name");
  await typeText(app, "secret");
  await tapPage(app, 205, BTN_Y);          // Next: the password
  await typeText(app, "hidehide9");
  await app.tap(205, BTN_Y);
  await app.waitFor(() => station().connected?.ssid === "Secret", 20000, "joined the hidden network");
  assert.equal(station().connected.ssid, "Secret");
});

storeShots(app, ["home", "networks", "status", "check-ok"]);
app.run.shutdown();
process.exit(T.done());
