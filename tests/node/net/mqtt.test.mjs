// MQTT: the unmodified SDK example `mqtt` end to end against a real WebSocket broker started here (router.mapBroker) and against the in-page
// broker; broker semantics (QoS, retained, wills, sessions, auth) at the packet level; the task-side kode_mqtt_* calls through net_api.
import { bootRadio, check, done, sleep } from "../radio/bench.mjs";
import { wsBroker } from "./servers.mjs";

// A factory-fresh bench has no name until the C5 has been seen once (khal_identity_init reads NVS), and the example builds its topics in its
// constructor: so the first boot shows the example refusing to connect without a name, and the second boot (NVS kept, as on a real board) runs it.
const a0 = await bootRadio("mqtt");
const { Broker, encodePacket, decoder } = a0.glue.net;
const ws = await wsBroker({ Broker, encodePacket, decoder });
const published = [];
ws.broker.on((e) => { if (e.type === "publish") published.push({ topic: e.topic, text: Buffer.from(e.payload).toString(), from: e.from }); });
const ID = "KODE38CWJWA001H", TIN = `kode/example/${ID}/in`, TOUT = `kode/example/${ID}/out`;
const rx = (s) => new RegExp(s.replace(/[/.\-]/g, "\\$&"));
const LEFT = 2, TOP = 4, BOT = 5, UP = 0, DOWN = 1, RIGHT = 3;
{
  a0.wifi.clearRouters();
  const h0 = a0.wifi.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40, internet: false });
  h0.mapBroker("broker.hivemq.com", 1883, ws.ws);
  await a0.cmd("radio_up");
  await a0.waitLog(/up; waiting for an address/, 10000);
  check(ws.connects.length === 0, "no address yet: the example has not touched the broker");
  const m0 = a0.mark(); await a0.press(TOP);
  await a0.waitLog(/not connected; trying again/, 3000, m0);
  check(published.length === 0, "not connected: a button publishes nothing");
  await a0.waitLog(/KODE services v3/, 10000);
  await a0.cmd('wifi_join ssid="Home" pass="hunter22"', 20000);
  await a0.waitLog(/joined 'Home'/, 10000);
  await a0.waitLog(/no device id, so no topic that is this board's own/, 15000, m0);
  await sleep(500);
  check(ws.connects.length === 0 && a0.net.mqttClients().length === 0, "first boot, board not named yet: the example refuses to use a shared topic and never connects");
  const snap = a0.snapshot();
  a0.shutdown();
  globalThis.__snap = snap;
}
const a = await bootRadio("mqtt", { boot: { persist: globalThis.__snap } });
a.wifi.clearRouters();
const home = a.wifi.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40, internet: false });
home.mapBroker("broker.hivemq.com", 1883, ws.ws);
a.world.timing.mqttReconnectMs = 300;
const until = async (f, what, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error("timeout: " + what + "\n" + a.logText().slice(-700) + "\nnotes: " + a.world.notes.slice(-6).join(" / ")); await sleep(25); } };

// The example asks AO_Net to connect the moment WIFI_STATE_SIG says GOT_IP, and its priority is above AO_Net's: now and then AO_Net has not yet
// processed the same event and answers "no network". That is the SDK's own race (it exists on the chip); the example's designed recovery is any
// button press. The bench follows the recovery and counts how often it was needed.
let raced = 0;
const listening = async (from, ms = 25000) => {
  const x = await a.waitLog(/listening on|broker down \(no network\)/, ms, from);
  if (/listening on/.test(x[0])) return;
  raced++; await sleep(300);
  const m2 = a.mark(); await a.press(BOT);
  await a.waitLog(/listening on/, 15000, m2);
};
// ---- second boot: named, and the C5 remembers Home, so the example connects by itself once the radio is up ----
let m = a.mark();
await listening(m);
await a.waitLog(rx(`listening on ${TIN}; the buttons publish to ${TOUT}`), 5000, m);
check(/joined 'Home'/.test(a.logText().slice(m)) && !/kode> wifi_join/.test(a.logText().slice(m)), "the radio came up by itself, the C5's vault joined Home with no wifi_join, and the example went on to connect");
check(ws.connects.length >= 1 && ws.connects[0].proto === "mqtt", "the client opened a WebSocket (subprotocol mqtt) to the real broker", ws.connects[0]);
check(ws.broker.clients().length === 1, "the broker has the device as its one client", ws.broker.clients());
const sess = ws.broker.sessions.get(ws.broker.clients()[0]);
check(sess && sess.subs.has(TIN), "the example subscribed to <topic root>/<serial>/in", sess && [...sess.subs.keys()]);
check(/connecting to mqtt:\/\/broker\.hivemq\.com:1883/.test(a.logText()), "the firmware's own URI is mqtt://broker.hivemq.com:1883, unchanged");
check(a.net.mqttClients().some((c) => c.state === "up" && c.uri === "mqtt://broker.hivemq.com:1883"), "the bench lists the client as up", a.net.mqttClients());

// ---- buttons publish ----
// A button edge that lands within a few ms of the boot's first one is now and then lost by the harness's button path (not the radio): press again, and say so.
let lostPresses = 0;
const pub = async (id, word) => {
  const n = published.length; await a.press(id);
  try { await until(() => published.length > n, `publish ${word}`, 2500); } catch { lostPresses++; await a.press(id); await until(() => published.length > n, `publish ${word} (second press)`); }
  return published[n];
};
let p = await pub(TOP, "top");
check(p.topic === TOUT && p.text === "top", "TOP publishes \"top\" on the board's /out topic", p);
p = await pub(BOT, "bottom"); check(p.text === "bottom" && p.topic === TOUT, "BOT publishes \"bottom\"", p);
p = await pub(LEFT, "left"); check(p.text === "left", "LEFT publishes \"left\"", p);
p = await pub(RIGHT, "right"); check(p.text === "right", "RIGHT publishes \"right\"", p);
p = await pub(UP, "up"); check(p.text === "up", "UP publishes \"up\"", p);
p = await pub(DOWN, "down"); check(p.text === "down", "DOWN publishes \"down\"", p);
check(/published "top"/.test(a.logText()), "the example logs what it published");

// ---- messages arrive and set the LED ----
const led = () => a.led();
const msg = async (text, retain = false) => { m = a.mark(); ws.broker.publish(TIN, text, { retain }); await a.waitLog(rx(`message on ${TIN}: "${text}"`), 5000, m); await sleep(150); };
await msg("red");   check(led()[0] > 0 && led()[1] === 0 && led()[2] === 0, "\"red\" lights the LED red", led());
await msg("green"); check(led()[1] > 0 && led()[0] === 0 && led()[2] === 0, "\"green\" lights it green", led());
await msg("blue");  check(led()[2] > 0 && led()[0] === 0 && led()[1] === 0, "\"blue\" lights it blue", led());
await msg("off");   check(led().every((v) => v === 0), "\"off\" turns it off", led());
await msg("red"); await msg("purple");
check(/not a colour this LED knows/.test(a.logText()) && led()[0] > 0, "an unknown word leaves the LED as it was", led());
m = a.mark(); ws.broker.publish(`kode/example/other/in`, "green");
await sleep(400);
check(!/message on kode\/example\/other/.test(a.logText().slice(m)), "a message on another board's topic is not delivered");
m = a.mark(); ws.broker.publish(TIN, "line1\nline2\u0001");
await a.waitLog(/message on [^\n]*: "line1\.line2\."/, 5000, m);
check(true, "a payload with a newline cannot forge a log line: it is printed with dots");
m = a.mark(); ws.broker.publish(TIN, "x".repeat(400));
await a.waitLog(/kaos\.net mqtt rx topic=\S+ len=240 \(cut\)/, 5000, m);
check(true, "a 400 byte payload reaches the firmware cut to the SDK's 240 byte limit, and AO_Net says (cut)");
await a.waitLog(/message on [^\n]*: "x{40,}/, 3000, m);

// ---- the connection is dropped by the broker: the client comes back and subscribes again ----
await msg("off");
let n0 = ws.connects.length; m = a.mark();
ws.broker.publish(TIN, "blue", { retain: true });   // a retained colour waits for whoever subscribes next
await sleep(200);
ws.dropAll();
await a.waitLog(/broker (connecting|down) \(/, 8000, m);
await a.waitLog(/listening on/, 15000, m);
check(ws.connects.length > n0, "after a drop the client reconnects by itself", ws.connects.length);
await a.waitLog(rx(`message on ${TIN}: "blue"`), 5000, m);
await sleep(200);
check(led()[2] > 0, "the retained message is delivered on the new subscription (the example subscribes again after every reconnect)", led());
ws.broker.publish(TIN, "", { retain: true });   // clear it

// ---- the router goes away: AO_Net stops the client; back on, it reconnects ----
m = a.mark(); home.powerOff();
await a.waitLog(/broker (down|connecting) \(/, 10000, m);
await until(() => ws.broker.clients().length === 0, "broker sees the client leave");
check(ws.broker.clients().length === 0, "router off: the client is gone from the broker");
await sleep(600);
m = a.mark(); home.powerOn();
await listening(m);
check(a.net.mqttClients().some((c) => c.state === "up"), "router back: the board rejoined and the client is up again", a.net.mqttClients());
n0 = published.length; p = await pub(TOP, "top again");
check(p.text === "top", "and the buttons publish again", p);

// ---- the broker goes away ----
await ws.close();
m = a.mark();
await a.waitLog(/broker (down|connecting) \(/, 10000, m);
await sleep(900);
check(a.net.mqttClients().every((c) => c.state !== "up"), "the broker is gone: the client is not up", a.net.mqttClients());
m = a.mark(); await a.press(TOP);
await a.waitLog(/not connected; trying again/, 4000, m);
check(!/published "top"/.test(a.logText().slice(m)), "no broker: a press does not claim to have published");
check(a.world.notes.some((n) => /WebSocket .* would not open|closed before opening/.test(n)), "the bench says the WebSocket would not open", a.world.notes.slice(-2));

// ---- a broker that wants a login: the example sends none ----
const ws2 = await wsBroker({ Broker, encodePacket, decoder }, { users: { alice: "wonderland" } });
home.mapBroker("broker.hivemq.com", 1883, ws2.ws);
m = a.mark(); await a.press(TOP);
await until(() => ws2.connects.length >= 1 && a.world.notes.some((n) => /connection refused, code 5/.test(n)), "the authenticating broker refused the client", 15000);
await a.waitLog(/broker (down|connecting) \(refused\)/, 5000, m);
check(/refused/.test(a.logText().slice(m)) && ws2.broker.clients().length === 0, "an authenticating broker refuses a client without credentials, and the example reports `refused`", a.logText().slice(m).split("\n").filter((l) => /broker|mqtt/.test(l)).slice(0, 4));
check(a.world.notes.some((n) => /connection refused, code 5/.test(n)), "the bench note has the CONNACK code (5: not authorized)", a.world.notes.filter((n) => /mqtt/.test(n)).slice(-4));
await ws2.close();

// ---- the in-page broker: no mapping, no internet ----
home.mapBroker("broker.hivemq.com", 1883, undefined);
home.brokerMap.delete("broker.hivemq.com:1883");
m = a.mark();
await until(() => a.net.mqttClients().some((c) => c.state === "up"), "in-page broker up", 20000).catch(async () => { await a.press(TOP); await until(() => a.net.mqttClients().some((c) => c.state === "up"), "in-page broker up after a press", 20000); });
await a.waitLog(/listening on/, 10000, m);
const ib = a.net.brokerOf(home);
check(ib instanceof Broker && ib.clients().length === 1, "internet off and no mapping: the device is on the router's in-page broker", ib?.clients());
const ipub = []; ib.on((e) => e.type === "publish" && ipub.push(Buffer.from(e.payload).toString()));
await a.press(LEFT); await until(() => ipub.includes("left"), "in-page publish");
check(true, "in-page broker: a button press reaches the bench");
m = a.mark(); ib.publish(TIN, "green"); await a.waitLog(/message on [^\n]*: "green"/, 5000, m); await sleep(150);
check(led()[1] > 0, "in-page broker: a bench publish lights the LED", led());
// internet on and no mapping: the real network is tried (and, in this sandbox, there is none)
home.setInternet(true);
m = a.mark(); ib.kill(ib.clients()[0]);
await a.waitLog(/broker (down|connecting) \(/, 8000, m);
await sleep(1200);
check(!a.net.mqttClients().some((c) => c.state === "up") || ib.clients().length === 0, "internet on, no in-page host: the client goes to the real hostname and does not stay on the bench broker", a.net.mqttClients());
home.setInternet(false);
await until(() => a.net.mqttClients().some((c) => c.state === "up"), "back on the in-page broker", 15000);
check(true, "internet off again: back on the in-page broker");

console.log(`note - the example's connect request lost the race with AO_Net ${raced} time(s) and was recovered by a button press`);
console.log(`note - presses that needed repeating: ${lostPresses}`);
done(a, "mqtt example");
