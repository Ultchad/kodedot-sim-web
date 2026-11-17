// kodeOS (role kodeos) over the radio areas: the real kdrv_radio / AO_Radio / AO_Net come up, kodeOS's Wi-Fi settings page lists the bench routers
// and joins one by touch, and the network time arrives (SNTP). Named *.kodeos-test.mjs so tests/node/run.sh does not pick it up (it needs the kodeOS
// package: `tools/dotbench build /home/claude/src/KodeOS --role kodeos`, then `node --expose-gc tests/node/radio/kodeos_radio.kodeos-test.mjs`).
import { bootRadio, check, done, sleep } from "./bench.mjs";

const a = await bootRadio("kodeos");
const home = a.wifi.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40, internet: true });
const cafe = a.wifi.addRouter({ ssid: "Cafe", channel: 1, signal: -60, internet: true });
const nonet = a.wifi.addRouter({ ssid: "NoNet", channel: 11, signal: -70, internet: false });
await a.waitFor(() => a.logText().includes("kgui first frame"), 120000, "kodeOS first frame");
await a.waitLog(/KODE services v3/, 30000);
const t = a.logText();
check(/kaos\.net network services up \(offline until there is an address\)/.test(t), "kodeOS: AO_Net is up and offline");
check(/kdrv\.radio link up; esp-hosted v2\.12\.9/.test(t), "kodeOS: the real kdrv_radio brought the C5 link up");
check(/khal\.id this board is KODE-/.test(t), "kodeOS: the board is named from the C5's MAC");
const missing = t.split("\n").filter((l) => /dotbench: (kdrv_(radio|c5|c5svc|wifi|net|frames)|esp_(hosted|wifi|netif|http|mqtt)|mqtt|lwip)\w* not implemented/.test(l));
check(missing.length === 0, "no 'not implemented' for radio, Wi-Fi or net functions (BLE and others belong to other areas)", missing.slice(0, 5));
await sleep(3000);

// ---- the control centre: swipe down, long-press the Wi-Fi circle: the Wi-Fi page scans and lists the routers ----
for (let y = 10; y <= 460; y += 50) { a.touch(205, y, true); await sleep(25); }
a.touch(205, 470, false); await a.waitLog(/gesture: release at \d+% .* -> open \(settings\)/, 5000);
await sleep(1500);
let m = a.mark();
a.touch(85, 94, true); await sleep(120); a.touch(85, 94, false);          // a tap switches Wi-Fi on
await a.waitLog(/kaos\.radio (no networks remembered yet|looking for a network we know|scanning)/, 8000, m);
await sleep(1500); m = a.mark();
a.touch(85, 94, true); await sleep(1200); a.touch(85, 94, false);         // a long press opens its page
await a.waitLog(/kgui wifi: scan over \(ok, (\d+) published\), (\d+) listed/, 15000, m);
const scan = a.logText().slice(m);
check(/kdrv\.wifi scan: 3 networks \(3 listed/.test(scan), "kodeOS: the Wi-Fi page's scan finds the three bench routers", scan.split("\n").filter((l) => /scan/.test(l)));
await sleep(1000);

// ---- join the open network by touching its row (the rows follow the strongest-first order: Home, Cafe, NoNet) ----
m = a.mark();
a.touch(200, 322, true); await sleep(120); a.touch(200, 322, false);
await a.waitLog(/kgui joining 'Cafe'/, 8000, m);
await a.waitLog(/kaos\.radio joined 'Cafe' as/, 15000, m);
check(a.wifi.station().connected?.ssid === "Cafe", "kodeOS: a touch on 'Cafe' joins it through the C5 (bench station says Cafe)", a.wifi.station());
await a.waitLog(/kdrv\.net asking pool\.ntp\.org what time it is/, 5000, m);
await a.waitLog(/kaos\.net the time arrived from the network: (\d{4}-\d\d-\d\dT[\d:]+Z)/, 10000, m);
check(true, "kodeOS: SNTP over the router with internet: the network time arrived");
check(/kaos\.radio 'Cafe' saved in the C5's vault/.test(a.logText().slice(m)) && a.radio.vault.list().includes("Cafe"), "kodeOS: the network is saved in the C5's vault", a.radio.vault.list());

// ---- losing and regaining the router ----
m = a.mark(); cafe.powerOff();
await a.waitLog(/the network went away/, 5000, m);
check(a.wifi.station().connected === null, "kodeOS: router off: the board reports the network gone");
await sleep(600); m = a.mark(); cafe.powerOn();
await a.waitLog(/kaos\.radio joined 'Cafe' as/, 30000, m);
await a.waitLog(/the time arrived from the network/, 10000, m);
check(true, "kodeOS: router back: AO_Radio rejoins by itself and asks for the time again");
await sleep(500);

// ---- a router without internet: joined, but no time ----
home.powerOff(); cafe.powerOff();
m = a.mark(); a.radio.vault.clear();
await a.waitLog(/the network went away/, 5000, m).catch(() => {});
await a.cmd('wifi_join ssid="NoNet"', 30000).catch(() => {});
await a.waitLog(/joined 'NoNet' as/, 15000, m);
await sleep(1500);
check(a.wifi.station().connected?.ssid === "NoNet" && !/the time arrived from the network/.test(a.logText().slice(m)), "kodeOS: a router with no internet gives an address and no network time", { station: a.wifi.station().connected, log: a.logText().slice(m).split("\n").filter((l) => /radio|net|time/.test(l)).slice(-12) });

done(a, "kodeOS radio");
