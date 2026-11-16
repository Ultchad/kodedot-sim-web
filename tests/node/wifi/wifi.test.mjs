// Wi-Fi: router bench objects under the SDK's real kdrv_wifi + AO_Radio (scan sweep, join, saved networks, loss, auto-rejoin, status).
import { bootRadio, check, done, sleep } from "../radio/bench.mjs";

const a = await bootRadio("network");
const W = a.wifi;
const home = W.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40 });
const cafe = W.addRouter({ ssid: "Cafe", channel: 1, signal: -61, security: "open" });
const five = W.addRouter({ ssid: "Home5G", password: "hunter22", channel: 149, signal: -52, security: "wpa2/wpa3" });
const hid = W.addRouter({ ssid: "Secret", password: "s3cretpass", channel: 11, hidden: true, signal: -55, security: "wpa3" });
const far = W.addRouter({ ssid: "Far", password: "farfarfar", channel: 3, signal: -70, inRange: false });
const off = W.addRouter({ ssid: "Sleeping", password: "zzzzzzzz", channel: 9, signal: -50, on: false });
await a.cmd("radio_up");
await a.waitLog(/KODE services v3/, 10000);

// ---- scan ----
let m = a.mark();
let r = await a.cmd("wifi_scan");
await a.waitLog(/kdrv\.wifi scan: \d+ networks/, 15000, m);
const rows = r.text.split("\n").filter((l) => l.startsWith(">|ssid=")).map((l) => /ssid="([^"]*)" rssi=(-?\d+) ch=(\d+) auth=(\d+) bssid=(\S+)/.exec(l));
const find = (s) => rows.find((x) => x && x[1] === s);
check(find("Home") && find("Home")[2] === "-40" && find("Home")[3] === "6" && find("Home")[4] === "3", "scan: a WPA2 router on channel 6 at -40 dBm", rows.map((x) => x?.[0]));
check(find("Cafe")?.[4] === "0", "scan: an open network has auth 0");
check(find("Home5G")?.[3] === "149" && find("Home5G")?.[4] === "7", "scan: a 5 GHz router (channel 149) is found by the 5 GHz steps, WPA2/WPA3 is auth 7");
check(find("")?.[3] === "11" && find("")?.[4] === "6", "scan: a hidden network shows with an empty name, WPA3 is auth 6");
check(!find("Far") && !find("Sleeping"), "scan: out-of-range and switched-off routers are not heard");
check(/over 7 steps \(0 refused\)/.test(a.logText()), "scan: the SDK's 3 + 4 step sweep ran");
check(rows.length === 4, "scan: exactly the four audible routers", rows.length);
check(a.events.filter((e) => e.type === "scan-done").length >= 7, "scan-done events, one per step");
// strongest first within a step is the C5's order; the SDK lists in arrival order
far.setInRange(true); off.powerOn();
m = a.mark(); r = await a.cmd("wifi_scan"); await a.waitLog(/kdrv\.wifi scan: \d+ networks/, 15000, m);
check(/ssid="Far"/.test(r.text) && /ssid="Sleeping"/.test(r.text), "scan: a router brought into range / switched on appears at the next scan");
far.setInRange(false); off.powerOff();

// ---- join ----
const joinLine = async (ssid, ms = 8000, from = 0) => (await a.waitLog(new RegExp(`joined '${ssid}' as ([\\d.]+)`), ms, from))[1];
m = a.mark();
r = await a.cmd('wifi_join ssid="Home" pass="hunter22"');
check(r.ok && (await joinLine("Home", 8000, m)) === home.ip, "join with the right password: got the router's DHCP address", r.lines);
check(a.wifi.station().connected?.ip === home.ip && a.wifi.station().connected?.ssid === "Home", "the bench sees the station joined");
check(/wifi=got_ip ssid="Home" ip=192\.168\.\d+\.\d+ rssi=-40/.test(r.lines.join()), "wifi_info status line: ssid, ip, rssi", r.lines);
let ni = await a.cmd("net_info");
check(new RegExp(`ip=${home.ip} gw=${home.gateway} mask=255.255.255.0 dns=${home.dns}`).test(ni.lines.join()), "net_info: address, gateway, mask and dns of the lease", ni.lines);
await a.waitLog(/'Home' saved in the C5's vault/, 5000, m);
check(a.radio.vault.list().includes("Home") && a.radio.vault.entries()[0].pass === "hunter22", "a good join is remembered in the C5's vault with its password");

// wrong password
m = a.mark();
r = await a.cmd('wifi_join ssid="Home5G" pass="WRONGWRONG"');
await a.waitLog(/'Home5G' refused us \(wrong password, reason 202\)/, 8000, m);
check(!a.radio.vault.list().includes("Home5G"), "a wrong password is not remembered");
check(a.wifi.station().connected === null, "after the refusal the station is not joined (the old network was left for the new attempt)");
home.update({ wrongPasswordReason: 15 });
m = a.mark(); await a.cmd('wifi_join ssid="Home" pass="nopenopenope"');
await a.waitLog(/'Home' refused us \(handshake timed out, reason 15\)/, 8000, m);
check(true, "a 4-way handshake timeout reason is classified as such by the SDK");
home.update({ wrongPasswordReason: 202 });

// open network, and a password given for an open network
m = a.mark(); await a.cmd('wifi_join ssid="Cafe"'); check((await joinLine("Cafe", 8000, m)) === cafe.ip, "join an open network without a password");
m = a.mark(); await a.cmd('wifi_join ssid="Cafe" pass="whatever1"'); await joinLine("Cafe", 8000, m); check(true, "an open network ignores a password that is given");
// hidden by name
m = a.mark(); await a.cmd('wifi_join ssid="Secret" pass="s3cretpass"'); check((await joinLine("Secret", 8000, m)) === hid.ip, "join a hidden network by name (WPA3)");
// 5 GHz
m = a.mark(); await a.cmd('wifi_join ssid="Home5G" pass="hunter22"'); await joinLine("Home5G", 8000, m);
check(a.wifi.station().connected?.channel === 149, "join on a 5 GHz channel");
// unknown / absent
m = a.mark(); await a.cmd('wifi_join ssid="Nowhere" pass="hunter22"');
await a.waitLog(/'Nowhere' refused us \(not found, or out of range/, 8000, m);
check(true, "a network that does not exist: refused as not found");
m = a.mark(); await a.cmd('wifi_join ssid="Far" pass="farfarfar"');
await a.waitLog(/'Far' refused us \(not found, or out of range/, 8000, m);
check(true, "a network out of range: not found");

// strongest of several routers with one name
const twin = W.addRouter({ ssid: "Twin", password: "twintwin1", channel: 2, signal: -80 });
const twin2 = W.addRouter({ ssid: "Twin", password: "twintwin1", channel: 4, signal: -48 });
m = a.mark(); await a.cmd('wifi_join ssid="Twin" pass="twintwin1"'); await joinLine("Twin", 8000, m);
check(a.wifi.station().connected?.routerId === twin2.id, "two routers with the same name: the stronger one wins");
twin.remove(); twin2.remove();

// ---- loss and auto rejoin ----
m = a.mark(); await a.cmd('wifi_join ssid="Home" pass="hunter22"'); await joinLine("Home", 8000, m);
m = a.mark(); home.powerOff();
await a.waitLog(/the network dropped \(reason 200\)/, 5000, m);
await a.waitLog(/the network went away/, 3000, m);
check(a.wifi.station().connected === null, "router switched off: the SDK reports the network dropped (beacon timeout)");
check(/wifi=disconnected/.test((await a.cmd("wifi_info")).lines.join()), "wifi_info says disconnected after the loss");
m = a.mark(); home.powerOn();
await a.waitLog(/joined 'Home' as/, 20000, m);
check(true, "the router comes back: AO_Radio rejoins on its own (saved network)");
m = a.mark(); home.setInRange(false);
await a.waitLog(/the network dropped \(reason 200\)/, 5000, m);
check(true, "out of range is a loss too");
home.setInRange(true); await a.waitLog(/joined 'Home' as/, 20000, m);
m = a.mark(); home.setSignal(-95);
await a.waitLog(/the network dropped/, 5000, m);
check(true, "a signal below the loss threshold drops the link");
home.setSignal(-40); await a.waitLog(/joined 'Home' as/, 20000, m);
m = a.mark(); home.kick(3);
await a.waitLog(/the network dropped \(reason 3\)/, 5000, m);
check(true, "the access point deauthenticates the station: reason 3 reaches the SDK");
await a.waitLog(/joined 'Home' as/, 20000, m);

// signal strength
const e0 = a.events.length;
home.setSignal(-67);
await sleep(300);
check(a.events.slice(e0).some((e) => e.type === "rssi" && e.dbm === -67), "bench: an rssi event when the signal changes");
// the SDK refreshes its cached reading only when something asks (kodeOS's status UI does, periodically); the C5 answers with the live value
const ap = await a.world.ops.get("wifi.ap_info")(new a.world.R(new Uint8Array(0)));
const apRssi = new a.world.R(ap.out); apRssi.lp(); apRssi.bytes(6); apRssi.u8();
check((apRssi.u8() << 24 >> 24) === -67, "esp_wifi_sta_get_ap_info (what kdrv_wifi_rssi reads) returns the new signal strength");
home.setSignal(-40);

// leave
m = a.mark(); await a.cmd("wifi_leave"); await sleep(1500);
check(a.wifi.station().connected === null, "wifi_leave: the station is no longer joined");

// ---- saved networks ----
const listed = (await a.cmd("wifi_list")).lines;
check(listed.length >= 3 && listed[0].includes("Home5G") || listed.some((l) => l.includes('"Home"')), "wifi_list: the vault's names", listed);
const mruBefore = a.radio.vault.list();
await a.cmd('wifi_forget ssid="Cafe"'); await sleep(500);
check(!a.radio.vault.list().includes("Cafe") && a.radio.vault.list().length === mruBefore.length - 1, "wifi_forget removes a saved network from the C5's vault");
// restart the radio: the C5 resets, the vault survives, auto join takes the most recently used reachable network
await a.cmd("radio_down"); await sleep(800);
m = a.mark(); await a.cmd("radio_up");
await a.waitLog(/trying '([^']+)'/, 15000, m);
const tried = /trying '([^']+)'/.exec(a.logText().slice(m))[1];
check(tried === mruBefore.filter((s) => s !== "Cafe")[0], "after a radio restart the SDK tries the most recently used saved network first", tried);
await a.waitLog(/joined '/, 15000, m);
// a saved network whose password changed: the next one is tried
await a.cmd("wifi_leave"); await sleep(800);
const joined = a.radio.vault.list()[0];
const bad = W.routers().find((x) => x.ssid === joined);
bad.update({ password: "changed-password" });
m = a.mark(); await a.cmd("wifi_auto");
await a.waitLog(/joined '/, 25000, m);
check(a.logText().slice(m).includes(`'${joined}'`) && /refused|would not join|trying/.test(a.logText().slice(m)), "auto join: a saved network with a changed password does not stop it; another is joined", a.logText().slice(m).split("\n").filter((l) => /radio|wifi/.test(l)).slice(0, 8));
bad.update({ password: "hunter22" });

// ---- DHCP that never answers ----
const nod = W.addRouter({ ssid: "NoDHCP", password: "nodhcp123", channel: 8, signal: -45, dhcp: false });
m = a.mark(); const nr = await a.cmd('wifi_join ssid="NoDHCP" pass="nodhcp123"', 40000);
check(/'NoDHCP': no address within 20000ms/.test(nr.text) && a.events.some((e) => e.type === "connected" && e.ssid === "NoDHCP") && a.wifi.station().connected === null, "a router with no DHCP: it associates, the SDK gives up after its 20 s with 'no address'", nr.text.slice(-300));
nod.remove();

// ---- C5 failures during Wi-Fi use ----
a.radio.setFault("mute");
m = a.mark(); a.type("wifi_scan");
await a.waitLog(/the C5 has stopped answering; the link is lost/, 20000, m);
check(true, "the C5 going mute during a scan: the SDK declares the link lost instead of hanging");
a.radio.setFault(null);

done(a, "wifi");
