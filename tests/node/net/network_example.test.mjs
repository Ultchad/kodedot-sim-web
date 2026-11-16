// The unmodified SDK example `network` end to end: its three buttons (ping 1.1.1.1, GET http://example.com/, a ping on a worker), against
// a router whose local hosts stand in for the internet (example.com forwards to a real HTTP server started here).
import { bootRadio, check, done, sleep } from "../radio/bench.mjs";
import { httpServer } from "./servers.mjs";

const srv = await httpServer();
const a = await bootRadio("network");
const home = a.wifi.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40, internet: false });
const TOP = 4, BOT = 5, LEFT = 2;

await a.cmd("radio_up");
await a.waitLog(/KODE services v3/, 10000);
await a.waitLog(/network up|up; the top button pings/, 10000);

// ---- no network: every button says so ----
let m = a.mark(); await a.press(TOP);
await a.waitLog(/no ping session \(status \d+\): is the board on a network/, 8000, m).catch(async () => { await a.waitLog(/not taken|no ping/, 3000, m); });
check(!/ping 1\.1\.1\.1, \d+ echoes\b[^]*\d+ of \d+ back/.test(a.logText().slice(m)), "no network: the ping does not report echoes");
m = a.mark(); await a.press(BOT);
await a.waitLog(/no GET \(status \d+\)|not taken/, 8000, m);
check(true, "no network: the GET button reports that nothing was fetched");
console.log("note - no network, TOP then BOT:\n" + a.logText().slice(m - 400).split("\n").filter((l) => /network\b|ping|GET/.test(l)).slice(-6).join("\n"));

// ---- the router and its local hosts ----
home.host("example.com", { ip: "93.184.216.34", upstream: srv.url });
const one = home.host("1.1.1.1", { ip: "1.1.1.1", latencyMs: 12, routes: {} });
await a.cmd('wifi_join ssid="Home" pass="hunter22"', 20000);
await a.waitLog(/joined 'Home' as/, 10000);
await sleep(400);

// ---- TOP: ping ----
m = a.mark(); await a.press(TOP);
await a.waitLog(/ping 1\.1\.1\.1, \d+ echoes/, 5000, m);
const pr = await a.waitLog(/1\.1\.1\.1: (\d+) of (\d+) back, min\/avg\/max (\d+)\/(\d+)\/(\d+) ms/, 15000, m);
check(pr[1] === pr[2] && Number(pr[2]) >= 1 && Number(pr[4]) >= 10, "TOP: every echo to 1.1.1.1 comes back with the host's latency", pr[0]);

// ---- BOT: GET http://example.com/ ----
m = a.mark(); await a.press(BOT);
await a.waitLog(/GET http:\/\/example\.com\//, 5000, m);
const gr = await a.waitLog(/status (\d+), body (\d+) bytes, (\d+) of them kept/, 10000, m);
check(gr[1] === "200" && gr[2] === "39" && gr[3] === "39", "BOT: GET http://example.com/ is served by the real server behind the router host", gr[0]);
check(a.logText().slice(m).includes("hello from the test server"), "BOT: the example's preview of the body shows the page");
check(srv.requests.at(-1)?.method === "GET" && srv.requests.at(-1)?.url === "/", "BOT: the server saw GET /", srv.requests.at(-1)?.url);
check(a.net.lastHttp().url === "http://example.com/" && a.net.lastHttp().via === "fetch", "BOT: the bench log has the URL as the firmware wrote it");

// ---- LEFT: the ping job on the worker thread ----
m = a.mark(); await a.press(LEFT);
await a.waitLog(/worker ping 1\.1\.1\.1/, 5000, m);
const wr = await a.waitLog(/1\.1\.1\.1: (\d+) of (\d+) back \(worker\)/, 15000, m);
check(wr[1] === wr[2], "LEFT: the worker's ping gets every echo", wr[0]);

// ---- a second press while one is out ----
m = a.mark(); await a.press(TOP); await a.press(BOT, 40);
await a.waitLog(/still waiting for the last answer|not taken/, 5000, m);
check(true, "busy: a press while a request is out is refused with a line, not queued behind it");
await a.waitLog(/1\.1\.1\.1: \d+ of \d+ back, min/, 15000, m);
await sleep(300);

// ---- unhappy paths ----
one.down = true;
m = a.mark(); await a.press(TOP);
const dn = await a.waitLog(/1\.1\.1\.1: (\d+) of (\d+) back/, 20000, m);
check(dn[1] === "0", "ping: a host that is down answers no echo", dn[0]);
one.down = false;
const ex = home.hosts.get("example.com"); ex.down = true;
m = a.mark(); await a.press(BOT);
await a.waitLog(/no GET \(status \d+\)/, 10000, m);
check(true, "GET: a host that is down is reported as no GET, the example does not hang");
ex.down = false; await sleep(400);
m = a.mark(); await a.press(BOT);
const again = await a.waitLog(/status (\d+), body (\d+) bytes/, 10000, m);
check(again[1] === "200", "GET: after the host is back the next press works", again[0]);
home.host("example.com", { ip: "93.184.216.34", routes: { "*": { status: 503, body: "maintenance" } } });
m = a.mark(); await a.press(BOT);
const e503 = await a.waitLog(/status (\d+), body (\d+) bytes, (\d+) of them kept/, 10000, m);
check(e503[1] === "503" && e503[2] === "11", "GET: a 503 is an answer: status 503 and its body", e503[0]);
home.host("example.com", { ip: "93.184.216.34", routes: { "*": { body: "z".repeat(30000) } } });
m = a.mark(); await a.press(BOT);
const big = await a.waitLog(/status (\d+), body (\d+) bytes, (\d+) of them kept/, 10000, m);
check(big[1] === "200" && big[2] === "30000" && Number(big[3]) < 30000, "GET: a body larger than the example's buffer is counted in full and kept in part", big[0]);

// ---- the router goes away and comes back ----
home.powerOff(); await sleep(1500);
m = a.mark(); await a.press(BOT);
await a.waitLog(/no GET \(status \d+\)|not taken/, 10000, m);
check(true, "router off: the GET button reports no network");
home.powerOn();
await a.waitLog(/joined 'Home' as|online as/, 20000, m);
await sleep(500);
home.host("example.com", { ip: "93.184.216.34", upstream: srv.url });
m = a.mark(); await a.press(BOT);
const back = await a.waitLog(/status (\d+), body (\d+) bytes/, 10000, m);
check(back[1] === "200", "router back: the board rejoined by itself and the GET works again", back[0]);

done(a, "network example");
