// Network: HTTP (local hosts, a real server behind a router host, fetch, CORS note), DNS, ping, UDP peers, SNTP and threading, under the
// SDK's real kdrv_net + AO_Net, driven through the net_api test app (the task-side calls of kode.h as console functions).
import { bootRadio, check, done, sleep } from "../radio/bench.mjs";
import { httpServer } from "./servers.mjs";

const srv = await httpServer();
const a = await bootRadio("net_api");
const W = a.wifi, N = a.net;
const home = W.addRouter({ ssid: "Home", password: "hunter22", channel: 6, signal: -40, internet: false });
home.host("api.test", { ip: "10.0.0.50", upstream: srv.url });
await a.cmd("radio_up");
await a.waitLog(/KODE services v3/, 10000);
/** Call a net_api function and wait for its "RES <kind> ..." line. */
const res = async (kind, arg, ms = 12000) => {
  const m = a.mark(); const r = await a.cmd(`function name="${kind}" arg=${JSON.stringify(arg)}`, 5000);
  const x = await a.waitLog(new RegExp(`RES ${kind} ([^\\n]*)`), ms, m);
  return { ok: r.ok, line: x[1], kv: Object.fromEntries([...x[1].matchAll(/(\w+)=(\[[^\]]*\]|\S+)/g)].map((k) => [k[1], k[2]])) };
};
const resNoArg = async (kind, ms = 12000) => { const m = a.mark(); await a.cmd(`function name="${kind}"`, 5000); const x = await a.waitLog(new RegExp(`RES ${kind} ([^\\n]*)`), ms, m); return x[1]; };

// ---- no network yet ----
let r = await res("hget", "http://api.test/hello");
check(r.kv.ok === "0", "http: no network, no GET (the SDK reports the failure)", r.line);
r = await res("udp", "10.0.0.60|9000|hi");
check(r.kv.ok === "0", "udp: no network, the send fails", r.line);
r = await res("resolve", "api.test");
check(r.kv.ok === "0", "dns: no network, no answer", r.line);

await a.cmd('wifi_join ssid="Home" pass="hunter22"', 20000);
await a.waitLog(/joined 'Home' as/, 10000);
await sleep(300);

// ---- GET through a router host that forwards to a real server ----
r = await res("hget", "http://api.test/hello");
check(r.kv.ok === "1" && r.kv.status === "200" && /hello from the test server/.test(r.kv.body), "http: GET 200 through a router host that forwards to a real server", r.line);
check(srv.requests.at(-1)?.method === "GET" && srv.requests.at(-1)?.url === "/hello", "http: the server saw GET /hello", srv.requests.at(-1)?.url);
check(N.lastHttp().url === "http://api.test/hello" && N.lastHttp().via === "fetch" && N.lastHttp().status === 200, "http: the bench log says what the firmware asked for and how it was served", N.lastHttp());
r = await res("hget", "http://api.test:8080/status?code=404");
check(r.kv.ok === "1" && r.kv.status === "404" && /status page/.test(r.kv.body), "http: a 404 is an answer, not a failure (any port reaches the router host)", r.line);
check(srv.requests.at(-1)?.url === "/status?code=404", "http: the query string reaches the server", srv.requests.at(-1)?.url);
r = await res("hget", "http://api.test/status?code=500");
check(r.kv.status === "500", "http: a 500 is returned as such", r.line);
r = await res("hget", "http://api.test/chunked");
check(r.kv.ok === "1" && r.kv.status === "200" && /part0;part1;part2;part3;part4;/.test(r.kv.body) && r.kv.len === "30", "http: a chunked body (no length) arrives whole, as it streams", r.line);
r = await res("hget", "http://api.test/nosuchpage");
check(r.kv.status === "404" && /not found/.test(r.kv.body), "http: unknown path is the server's 404", r.line);

// ---- redirects: kode.h says a redirect is not followed, but kdrv_net.c leaves esp_http_client's default (it follows up to ten) for GET and POST ----
const before = srv.requests.length;
r = await res("hget", "http://api.test/redirect");
check(r.kv.ok === "1" && r.kv.status === "200" && /hello from the test server/.test(r.kv.body), "http: the real client follows a 302 for GET (max_redirection_count 0 means its default of ten), so the target's page comes back", r.line);
check(srv.requests.slice(before).map((x) => x.url).join() === "/redirect,/hello", "http: the server saw the redirect and then its target", srv.requests.slice(before).map((x) => x.url));

// ---- POST ----
r = await res("hpost", 'http://api.test/echo|{"a":1}');
check(r.kv.status === "200" && /"method":"POST"/.test(r.kv.body) && srv.requests.at(-1)?.body.toString() === '{"a":1}' && srv.requests.at(-1)?.method === "POST", "http: POST sends the body", srv.requests.at(-1)?.body.toString());
check(srv.requests.at(-1)?.headers["content-type"] === "application/json", "http: a body that starts with { is sent as application/json", srv.requests.at(-1)?.headers);
r = await res("hpost", "http://api.test/echo|plain words");
check(srv.requests.at(-1)?.headers["content-type"] === "text/plain; charset=utf-8" && srv.requests.at(-1)?.body.toString() === "plain words", "http: other text is sent as text/plain", srv.requests.at(-1)?.headers["content-type"]);
r = await res("hpost", "http://api.test/echo|");
check(r.kv.status === "200" && srv.requests.at(-1)?.body.length === 0, "http: an empty POST body is empty on the wire", r.line);

// ---- ranges, resume ----
r = await res("hrange", "http://api.test/big|0|16");
check(r.kv.ok === "1" && r.kv.status === "206" && r.kv.got === "16" && r.kv.total === "100000" && /ABCDEFGHIJKLMNOP/.test(r.kv.body), "range: the first 16 bytes come as a 206 with the total", r.line);
check(srv.requests.at(-1)?.headers.range === "bytes=0-15", "range: the Range header on the wire", srv.requests.at(-1)?.headers.range);
r = await res("hrange", "http://api.test/big|26|8");
check(r.kv.status === "206" && /ABCDEFGH/.test(r.kv.body), "range: resuming at byte 26 gets the bytes from 26", r.line);
r = await res("hrange", "http://api.test/big|99995|100");
check(r.kv.status === "206" && r.kv.got === "5", "range: a range cut at the end of the resource returns what is left", r.line);
r = await res("hrange", "http://api.test/big|200000|16");
check(r.kv.ok === "1" && r.kv.status === "416" && r.kv.got === "0", "range: an offset past the end is a 416 with nothing read", r.line);
// the resource itself, in pieces: what a downloader would do
let got = "", off = 0;
for (let i = 0; i < 30 && got.length < 100000; i++) {
  const p = await res("hrange", `http://api.test/big|${off}|4000`);
  if (p.kv.status !== "206") break;
  off += Number(p.kv.got); got += "x".repeat(Number(p.kv.got));
}
check(got.length === 100000, "range: 100000 bytes fetched in 4000-byte pieces add up", got.length);

// ---- limits of the SDK ----
r = await res("hget", "http://api.test/big");
check(r.kv.len === "0", "http: an answer over KODE_HTTP_BODY_MAX (64 KiB) is not handed out: kode_http_get returns an empty body", r.line);
console.log("note - /big (100000 bytes) via kode_http_get: " + r.line);

// ---- errors: unreachable, down, no internet ----
r = await res("hget", "http://nosuch.test/");
check(r.kv.ok === "0" && /unreach|connect|network|host/i.test(r.line), "http: a host the router does not know and no internet is unreachable", r.line);
check(a.world.notes.some((n) => /no local host 'nosuch.test'/.test(n)), "http: the bench says why (no internet and no local host)");
const dead = home.host("dead.test", { ip: "10.0.0.51", routes: { "*": { body: "alive" } } });
r = await res("hget", "http://dead.test/");
check(r.kv.status === "200" && /alive/.test(r.kv.body), "http: a canned local host answers with the router's internet off", r.line);
dead.down = true;
r = await res("hget", "http://dead.test/");
check(r.kv.ok === "0", "http: a host that is down is unreachable", r.line);
dead.down = false;

// ---- local hosts: canned routes, handlers, headers, JSON, ranges ----
let seen;
home.host("canned.test", {
  ip: "10.0.0.52",
  routes: {
    "GET /json": { body: { ok: true, n: 3 } },
    "GET /teapot": { status: 418, headers: { "X-Brew": "tea" }, body: "short and stout" },
    "POST /submit": (req) => { seen = req; return { status: 201, body: "got " + new TextDecoder().decode(req.body) }; },
    "GET /file": { body: "0123456789abcdefghij" },
    "GET /slowish": { body: "late", delayMs: 400 },
  },
});
r = await res("hget", "http://canned.test/json");
check(r.kv.status === "200" && /"ok":true/.test(r.kv.body), "local host: an object body is sent as JSON", r.line);
r = await res("hget", "http://canned.test/teapot");
check(r.kv.status === "418" && /short and stout/.test(r.kv.body), "local host: a canned status", r.line);
r = await res("hpost", "http://canned.test/submit|hello there");
check(r.kv.status === "201" && /got hello there/.test(r.kv.body) && seen?.method === "POST" && seen?.path === "/submit" && seen?.headers["content-type"] === "text/plain; charset=utf-8", "local host: a handler sees method, path, headers and body", { line: r.line, seen: seen && { m: seen.method, p: seen.path } });
r = await res("hrange", "http://canned.test/file|10|5");
check(r.kv.status === "206" && /abcde/.test(r.kv.body) && r.kv.total === "20", "local host: ranges are honoured on a plain body", r.line);
const t0 = Date.now(); r = await res("hget", "http://canned.test/slowish");
check(r.kv.status === "200" && Date.now() - t0 >= 380, "local host: a response can be delayed", Date.now() - t0);
r = await res("hget", "http://canned.test/missing");
check(r.kv.status === "404", "local host: an unknown route is a 404", r.line);
home.host("canned.test", { ip: "10.0.0.52", handler: (req) => ({ body: `${req.method} ${req.host}${req.path}?${req.query}` }) });
r = await res("hget", "http://canned.test/any/where?x=1&y=2");
check(/GET canned.test\/any\/where\?x=1&y=2/.test(r.kv.body), "local host: a catch-all handler sees host, path and query", r.line);
r = await res("hget", "https://canned.test/secure");
check(r.kv.status === "200" && /GET canned.test\/secure/.test(r.kv.body), "local host: https:// to a local host works as well", r.line);
r = await res("hget", "http://10.0.0.52/by/address");
check(/by\/address/.test(r.kv.body), "local host: reachable by its address", r.line);
home.host("cut.test", { ip: "10.0.0.53", routes: { "*": { body: "x".repeat(5000), truncateAfter: 1200 } } });
r = await res("hget", "http://cut.test/");
check(r.kv.ok === "0", "local host: a body that breaks off after 1200 of 5000 bytes is a failed request, not a short page", r.line);
console.log("note - truncated body via kode_http_get: " + r.line);
home.removeHost("cut.test");
r = await res("hget", "http://cut.test/");
check(r.kv.ok === "0", "local host: a removed host is gone", r.line);

// ---- fetch with the router's internet on ----
home.setInternet(true);
r = await res("hget", `${srv.url}/hello`);
check(r.kv.status === "200" && /hello from the test server/.test(r.kv.body) && N.lastHttp().via === "fetch", "internet: a real URL is fetched", r.line);
r = await res("hget", `${srv.url}/nocors`);
check(r.kv.status === "200" && /no cors headers/.test(r.kv.body), "internet: node has no CORS, so a server without the headers answers", r.line);
r = await res("hget", "http://127.0.0.1:1/");   // a closed port
check(r.kv.ok === "0", "internet: a refused connection is a failure the SDK reports", r.line);
home.setInternet(false);
r = await res("hget", `${srv.url}/hello`);
check(r.kv.ok === "0", "internet: switching the router's internet off cuts the real server off again", r.line);

// ---- the CORS message: fetch refusing a cross-origin response (a fake fetch, as the browser test does it for real) ----
home.setInternet(true);
const realFetch = globalThis.fetch;
globalThis.location = { origin: "http://page.test" };
const calls = [];
N.setFetch(async (url, init) => { calls.push({ url, mode: init?.mode }); if (init?.mode === "no-cors") return { ok: true, type: "opaque" }; throw new TypeError("Failed to fetch"); });
r = await res("hget", "http://cross.example/data");
check(r.kv.ok === "0", "cors: the firmware sees an unreachable host", r.line);
check(calls.length === 2 && calls[1].mode === "no-cors", "cors: after the TypeError the page probes with no-cors to tell CORS from a dead host", calls);
check(N.corsLog.length === 1 && /CORS: the browser refused http:\/\/cross.example\/data/.test(N.corsLog[0].msg) && /http:\/\/page.test/.test(N.corsLog[0].msg), "cors: a clear message names the URL and the page origin", N.corsLog[0]?.msg);
check(a.events.some((e) => e.type === "area:net:cors" || e.type === "cors"), "cors: an event for the bench UI", a.events.map((e) => e.type).slice(-5));
check(/CORS: the browser refused/.test(a.logText()) || a.world.notes.some((n) => /CORS:/.test(n)), "cors: the message is in the bench notes", a.world.notes.slice(-3));
N.corsLog.length = 0;
N.setFetch(async (url, init) => { throw new TypeError("Failed to fetch"); });
r = await res("hget", "http://dead.example/");
check(r.kv.ok === "0" && N.corsLog.length === 0, "cors: a host that is simply down is not blamed on CORS", N.corsLog);
N.setFetch(async (url, init) => new Response("faked body", { status: 200, headers: { "content-length": "10" } }));
r = await res("hget", "http://any.example/");
check(r.kv.status === "200" && /faked body/.test(r.kv.body), "fetch: a replaced fetch serves the request", r.line);
N.setFetch(null); delete globalThis.location;
home.setInternet(false);

// ---- stall: a server that never answers; the page stays responsive ----
home.host("stall.test", { ip: "10.0.0.54", routes: { "*": { stall: true } } });
let maxGap = 0, last = Date.now(); const lag = setInterval(() => { const n = Date.now(); maxGap = Math.max(maxGap, n - last); last = n; }, 20);
const ts = Date.now(), m0 = a.mark();
a.type('function name="hget" arg="http://stall.test/"');
await sleep(1500);
const info = await a.cmd("net_info", 5000);
check(info.ok && /ip=/.test(info.text), "threading: the console answers while a request is stalled");
const stalled = await a.waitLog(/RES hget ([^\n]*)/, 20000, m0);
const took = Date.now() - ts;
clearInterval(lag);
check(/ok=0/.test(stalled[1]) && took >= 14000 && took < 19000, "http: a server that never answers fails after the SDK's 15 s timeout", { took, line: stalled[1] });
check(maxGap < 250, "threading: the page's event loop was never blocked for 250 ms while the firmware waited", maxGap);

// ---- DNS ----
r = await res("resolve", "canned.test");
check(r.kv.ok === "1" && r.kv.ip === "10.0.0.52", "dns: a router host resolves to its address", r.line);
r = await res("resolve", "192.168.7.7");
check(r.kv.ip === "192.168.7.7", "dns: an address resolves to itself", r.line);
r = await res("resolve", "localhost");
check(r.kv.ip === "127.0.0.1", "dns: localhost", r.line);
home.update?.({ dnsNames: { "printer.lan": "192.168.2.77" } }); home.dnsNames = { ...(home.dnsNames || {}), "printer.lan": "192.168.2.77" };
r = await res("resolve", "printer.lan");
check(r.kv.ip === "192.168.2.77", "dns: a name the router's DNS table holds", r.line);
r = await res("resolve", "nowhere.example");
check(r.kv.ok === "0", "dns: with no internet an unknown name does not resolve", r.line);
home.setInternet(true);
r = await res("resolve", "nowhere.example");
const syn = r.kv.ip;
check(r.kv.ok === "1" && /^203\.0\.113\.\d+$/.test(syn), "dns: with internet an unknown name gets a synthetic TEST-NET-3 address (no real DNS in a page)", r.line);
r = await res("resolve", "nowhere.example");
check(r.kv.ip === syn, "dns: the synthetic address is stable", r.line);
home.setInternet(false);

// ---- ping ----
r = await res("ping", "10.0.0.52|3", 20000);
check(r.kv.ok === "1" && r.kv.sent === "3" && r.kv.received === "3" && Number(r.kv.avg) > 0, "ping: a local host answers every echo", r.line);
r = await res("ping", "canned.test|1");
check(r.kv.received === "1", "ping: by name", r.line);
r = await res("ping", "10.0.0.99|2", 20000);
check(r.kv.ok === "1" && r.kv.received === "0" && r.kv.sent === "2", "ping: an address nobody holds times out; that is a result, not a failure", r.line);
home.host("ping.test", { ip: "10.0.0.60", latencyMs: 40, routes: { "*": { body: "" } } });
r = await res("ping", "ping.test|2", 20000);
check(r.kv.received === "2" && Number(r.kv.avg) >= 30, "ping: a host's latency is the round trip time", r.line);
dead.down = true;
r = await res("ping", "dead.test|1", 20000);
check(r.kv.received === "0", "ping: a down host does not answer", r.line);
dead.down = false;

// ---- UDP ----
const got1 = [], peer = home.udpPeer("10.0.0.70", 9000, (bytes, info) => got1.push(Buffer.from(bytes).toString()));
r = await res("udp", "10.0.0.70|9000|hello peer");
check(r.kv.ok === "1", "udp: a datagram to a bench peer leaves", r.line);
await sleep(200);
check(got1.length === 1 && got1[0] === "hello peer" && peer.received.length === 1, "udp: the peer got the bytes", got1);
r = await res("udp", "10.0.0.70|9001|wrong port");
await sleep(150);
check(r.kv.ok === "1" && got1.length === 1, "udp: another port has no peer: the send still succeeds (fire and forget), nothing is delivered", got1);
home.host("peer.test", { ip: "10.0.0.70", routes: {} });
r = await res("udp", "peer.test|9000|by name");
await sleep(150);
check(got1.length === 2 && got1[1] === "by name", "udp: a host name resolves to the peer", got1);
r = await res("udp", "10.0.0.70|9000|");
await sleep(150);
check(r.kv.ok === "0" && got1.length === 2, "udp: an empty datagram is refused by kdrv_net_udp_send (kode.h allows len 0: doc/code disagreement, see STATUS)", { line: r.line, got1 });
check(N.udpLog.filter((u) => u.ip === "10.0.0.70").length >= 3, "udp: the bench log has every datagram, delivered or not", N.udpLog.length);
peer.send(Uint8Array.of(1, 2, 3));
check(N.udpLog.at(-1)?.undelivered === true, "udp: a peer's reply is recorded as undelivered: the SDK has no UDP receive path");
r = await res("udp", "no.such.host.example|9000|x");
check(r.kv.ok === "0", "udp: an unresolvable host fails", r.line);

// ---- SNTP: asked at the first address, answered only when the router has internet ----
check(/asking pool\.ntp\.org what time it is/.test(a.logText()) && !/the time arrived from the network/.test(a.logText()), "sntp: the time client starts with the first address; with no internet nobody answers");
home.setInternet(true);
let ms = a.mark();
await a.cmd("wifi_leave", 15000); await sleep(300);
await a.cmd('wifi_join ssid="Home" pass="hunter22"', 20000);
await a.waitLog(/back online: asking for the time again/, 10000, ms);
await a.waitLog(/the time arrived from the network: \d{4}-\d\d-\d\d/, 10000, ms);
check(true, "sntp: with internet the second address asks again and the time arrives");
home.setInternet(false);

// ---- the network going away under a request ----
home.host("slow.test", { ip: "10.0.0.80", routes: { "*": { body: "never seen", delayMs: 800 } } });
const m1 = a.mark(); a.type('function name="hget" arg="http://slow.test/"'); await sleep(200);
home.powerOff();
const lost = await a.waitLog(/RES hget ([^\n]*)/, 20000, m1);
check(/ok=0/.test(lost[1]), "http: the router going away mid-request fails the request (no hang, no answer from a dead network)", lost[1]);
console.log("note - request overtaken by a router power cut: " + lost[1]);
await sleep(400);
home.powerOn();
await a.waitLog(/joined 'Home' as/, 25000, m1).catch(() => {});

done(a, "net");
