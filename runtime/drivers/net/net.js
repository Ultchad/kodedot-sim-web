// SPDX-License-Identifier: GPL-3.0-or-later
// Network bench glue: HTTP(S) via fetch (with per-router local hosts), MQTT (codec, WebSocket client, in-page broker), UDP bench peers,
// DNS, ping and SNTP, behind esp_http_client / esp-mqtt / getaddrinfo / ping_sock / esp_netif_sntp (net_shim.c).
// Needs radio.js and wifi.js (the world, ctx.module.__dbw). Everything here runs in the page without blocking it.
//
// Router additions (router = wifi.js's object):
//   router.host(name, { ip?, routes?: { "GET /path": resp | (req) => resp }, handler?: (req) => resp, latencyMs? })   a local host with canned responses
//        resp = { status=200, headers?, body? (string | Uint8Array | JSON-able), delayMs?, stall?: true, truncateAfter?: n (body breaks after n bytes), ranges?: false }
//        a body without an explicit status honours Range (206 / 416). Requests carry { method, url, host, port, path, query, headers (lower case), body: Uint8Array }.
//        https:// and http:// to a local host both work. Local hosts answer even with router.internet = false, and override the real internet when it is on.
//   router.udpPeer(ip, port, (bytes, info) => void) -> peer { received[], send(bytes) }     bench side of UDP (the SDK only ever sends; see STATUS-radio.md)
//   router.host(name, { upstream: "http://127.0.0.1:8080" })   forward to a real server; router.mapBroker(host, port, "ws://127.0.0.1:9001")   map an mqtt:// endpoint to a real WS broker
//   router.enableBroker({ users?: {name: pass}, hosts?: [names] }) -> broker      the in-page MQTT broker. Default endpoint when internet is off.
// api: lastHttp(), httpLog, corsLog, udpLog, brokerOf(router), setFetch(fn), setWebSocket(cls), mqttUrl(uri)
// events (area:net:<type>): http {method,url,status,via}  cors {url,origin}  unreachable {url,why}  mqtt {state}  udp {to,port,bytes,peer}  ping {ip,ok}

const E_CONNECT = 0x7001, E_FETCH_HEADER = 0x7003;
const te = new TextEncoder(), td = new TextDecoder();
const ip2u32 = (s) => { const p = String(s).split(".").map(Number); return (p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 0; };
const u32ip = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join(".");
const isIp = (s) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s);
function withWorld(M, cb) { if (M.__dbw) cb(M.__dbw); else (M.__dbwq ||= []).push(cb); }

// ---- MQTT 3.1.1 codec ----
const T = { CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, SUBSCRIBE: 8, SUBACK: 9, UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14 };
const u16b = (n) => [n >> 8, n & 255];
const mstr = (s) => { const b = typeof s === "string" ? te.encode(s) : s; return [...u16b(b.length), ...b]; };
function remLen(n) { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return o; }
export function encodePacket(p) {
  let first, body = [];
  switch (p.type) {
    case T.CONNECT: {
      first = 0x10;
      let fl = (p.clean ? 2 : 0);
      if (p.will) fl |= 4 | ((p.will.qos & 3) << 3) | (p.will.retain ? 32 : 0);
      if (p.password) fl |= 64; if (p.username) fl |= 128;
      body = [...mstr("MQTT"), 4, fl, ...u16b(p.keepalive ?? 60), ...mstr(p.clientId || "")];
      if (p.will) body.push(...mstr(p.will.topic), ...mstr(p.will.payload || new Uint8Array(0)));
      if (p.username) body.push(...mstr(p.username)); if (p.password) body.push(...mstr(p.password));
      break;
    }
    case T.CONNACK: first = 0x20; body = [p.sessionPresent ? 1 : 0, p.code || 0]; break;
    case T.PUBLISH: first = 0x30 | (p.dup ? 8 : 0) | ((p.qos & 3) << 1) | (p.retain ? 1 : 0); body = mstr(p.topic); if (p.qos > 0) body.push(...u16b(p.id)); body.push(...(p.payload || [])); break;
    case T.PUBACK: first = 0x40; body = u16b(p.id); break;
    case T.SUBSCRIBE: first = 0x82; body = u16b(p.id); for (const s of p.subs) body.push(...mstr(s.filter), s.qos); break;
    case T.SUBACK: first = 0x90; body = [...u16b(p.id), ...p.codes]; break;
    case T.UNSUBSCRIBE: first = 0xa2; body = u16b(p.id); for (const f of p.filters) body.push(...mstr(f)); break;
    case T.UNSUBACK: first = 0xb0; body = u16b(p.id); break;
    case T.PINGREQ: first = 0xc0; break;
    case T.PINGRESP: first = 0xd0; break;
    case T.DISCONNECT: first = 0xe0; break;
    default: throw new Error("unsupported MQTT packet " + p.type);
  }
  return Uint8Array.from([first, ...remLen(body.length), ...body]);
}
/** Streaming decoder: feed(bytes) returns the complete packets. */
export function decoder() {
  let buf = new Uint8Array(0);
  return (chunk) => {
    const n = new Uint8Array(buf.length + chunk.length); n.set(buf); n.set(chunk, buf.length); buf = n;
    const out = [];
    for (;;) {
      if (buf.length < 2) break;
      let mult = 1, len = 0, i = 1, d;
      do { if (i >= buf.length) return out; d = buf[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128);
      if (buf.length < i + len) break;
      out.push(parsePacket(buf[0], buf.subarray(i, i + len)));
      buf = buf.slice(i + len);
    }
    return out;
  };
}
function parsePacket(h, b) {
  const type = h >> 4; let p = 0;
  const u16 = () => { const v = (b[p] << 8) | b[p + 1]; p += 2; return v; };
  const str = () => { const l = u16(); const s = b.slice(p, p + l); p += l; return s; };
  switch (type) {
    case T.CONNECT: {
      str(); const level = b[p++], fl = b[p++], keepalive = u16(); const clientId = td.decode(str());
      const o = { type, level, clean: !!(fl & 2), keepalive, clientId };
      if (fl & 4) o.will = { qos: (fl >> 3) & 3, retain: !!(fl & 32), topic: td.decode(str()), payload: str() };
      if (fl & 128) o.username = td.decode(str()); if (fl & 64) o.password = td.decode(str());
      return o;
    }
    case T.CONNACK: return { type, sessionPresent: !!(b[0] & 1), code: b[1] };
    case T.PUBLISH: { const qos = (h >> 1) & 3, o = { type, qos, dup: !!(h & 8), retain: !!(h & 1), topic: td.decode(str()) }; if (qos) o.id = u16(); o.payload = b.slice(p); return o; }
    case T.PUBACK: case T.UNSUBACK: return { type, id: u16() };
    case T.SUBSCRIBE: { const o = { type, id: u16(), subs: [] }; while (p < b.length) { const f = td.decode(str()); o.subs.push({ filter: f, qos: b[p++] }); } return o; }
    case T.SUBACK: { const id = u16(); return { type, id, codes: Array.from(b.slice(p)) }; }
    case T.UNSUBSCRIBE: { const o = { type, id: u16(), filters: [] }; while (p < b.length) o.filters.push(td.decode(str())); return o; }
    default: return { type };
  }
}
export function topicMatches(filter, topic) {
  const f = filter.split("/"), t = topic.split("/");
  if (topic.startsWith("$") && (f[0] === "#" || f[0] === "+")) return false;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (i >= t.length) return false;
    if (f[i] !== "+" && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** The in-page broker: MQTT 3.1.1 semantics at QoS 0/1 (QoS 2 is granted as 1), retained messages, wills, persistent sessions, simple auth. */
export class Broker {
  constructor(opts = {}) { this.users = opts.users || null; this.hosts = opts.hosts || []; this.sessions = new Map(); this.retained = new Map(); this.published = []; this.closed = false; this.listeners = new Set(); }
  /** transport = { send(packet), close() }; returns the handler for packets from the client. */
  accept(transport) {
    const conn = { t: transport, session: null, gone: false };
    return {
      packet: (p) => this._packet(conn, p),
      closed: (graceful) => this._drop(conn, graceful),
    };
  }
  _packet(conn, p) {
    if (this.closed) return;
    if (p.type === T.CONNECT) {
      if (p.level !== 4 && p.level !== 3) return this._refuse(conn, 1);
      if (!p.clientId && !p.clean) return this._refuse(conn, 2);
      if (this.users) {
        if (p.username === undefined) return this._refuse(conn, 5);
        if (this.users[p.username] !== p.password) return this._refuse(conn, this.users[p.username] === undefined ? 5 : 4);
      }
      const id = p.clientId || "auto-" + Math.random().toString(16).slice(2, 10);
      const old = this.sessions.get(id);
      if (old && old.conn) { old.conn.gone = true; old.conn.t.close(); old.willOnDrop = false; }
      let present = false, s;
      if (old && !p.clean) { s = old; present = true; } else s = { id, subs: new Map(), conn: null, inflight: [] };
      s.clean = p.clean; s.conn = conn; s.will = p.will || null; s.keepalive = p.keepalive; s.username = p.username; s.lastSeen = Date.now();
      this.sessions.set(id, s); conn.session = s;
      conn.t.send({ type: T.CONNACK, sessionPresent: present, code: 0 });
      this.listeners.forEach((f) => f({ type: "connect", clientId: id }));
      for (const m of s.inflight.splice(0)) this._deliver(s, m);
      return;
    }
    const s = conn.session;
    if (!s) return conn.t.close();
    s.lastSeen = Date.now();
    switch (p.type) {
      case T.PUBLISH:
        if (p.qos === 1) conn.t.send({ type: T.PUBACK, id: p.id });
        this.publish(p.topic, p.payload, { retain: p.retain, qos: Math.min(p.qos, 1), from: s.id });
        break;
      case T.SUBSCRIBE: {
        const codes = [];
        for (const sub of p.subs) { s.subs.set(sub.filter, Math.min(sub.qos, 1)); codes.push(Math.min(sub.qos, 1)); }
        conn.t.send({ type: T.SUBACK, id: p.id, codes });
        for (const sub of p.subs) for (const [topic, m] of this.retained) if (topicMatches(sub.filter, topic)) this._deliver(s, { ...m, retain: true }, Math.min(sub.qos, m.qos));
        break;
      }
      case T.UNSUBSCRIBE: for (const f of p.filters) s.subs.delete(f); conn.t.send({ type: T.UNSUBACK, id: p.id }); break;
      case T.PINGREQ: conn.t.send({ type: T.PINGRESP }); break;
      case T.PUBACK: break;
      case T.DISCONNECT: s.will = null; this._drop(conn, true); conn.t.close(); break;
      default: break;
    }
  }
  _refuse(conn, code) { conn.t.send({ type: T.CONNACK, sessionPresent: false, code }); conn.gone = true; setTimeout(() => conn.t.close(), 0); }
  _drop(conn, graceful) {
    if (conn.gone && !conn.session) return;
    const s = conn.session; conn.gone = true;
    if (!s || s.conn !== conn) return;
    s.conn = null;
    if (!graceful && s.will) this.publish(s.will.topic, s.will.payload, { retain: s.will.retain, qos: Math.min(s.will.qos, 1), from: s.id });
    if (s.clean) this.sessions.delete(s.id);
    this.listeners.forEach((f) => f({ type: "disconnect", clientId: s.id }));
  }
  _deliver(s, m, qos) {
    const q = Math.min(qos ?? m.qos, 1);
    if (!s.conn) { if (!s.clean && q > 0) s.inflight.push(m); return; }
    s.conn.t.send({ type: T.PUBLISH, topic: m.topic, payload: m.payload, qos: q, retain: !!m.retain, id: q ? (s.nextId = ((s.nextId || 0) % 65535) + 1) : 0 });
  }
  /** Publish from the bench (or a client). */
  publish(topic, payload, { retain = false, qos = 0, from = null } = {}) {
    payload = typeof payload === "string" ? te.encode(payload) : payload instanceof Uint8Array ? payload : Uint8Array.from(payload || []);
    const m = { topic, payload, qos, retain };
    this.published.push({ topic, payload, retain, qos, from });
    if (this.published.length > 500) this.published.shift();
    if (retain) { if (payload.length) this.retained.set(topic, m); else this.retained.delete(topic); }
    for (const s of this.sessions.values()) {
      let best = -1;
      for (const [f, q] of s.subs) if (topicMatches(f, topic)) best = Math.max(best, q);
      if (best >= 0) this._deliver(s, { ...m, retain: false }, Math.min(qos, best));
    }
    this.listeners.forEach((f) => f({ type: "publish", topic, payload, from }));
  }
  clients() { return [...this.sessions.values()].filter((s) => s.conn).map((s) => s.id); }
  kill(clientId) { const s = this.sessions.get(clientId); if (s?.conn) { const c = s.conn; this._drop(c, false); c.t.close(); } }
  close() { this.closed = true; for (const s of this.sessions.values()) if (s.conn) { const c = s.conn; this._drop(c, false); c.t.close(); } }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
}

export default function create(ctx) {
  const M = ctx.module;
  let w = null;
  const api = { httpLog: [], corsLog: [], udpLog: [], pingLog: [], mqttLog: [], fetchImpl: null, WebSocketImpl: null };
  const sessions = new Map();   // http id -> body session
  const clients = new Map();    // mqtt id -> client
  const pings = new Map();
  let sntp = false;
  const emit = (t, d) => w?.event(t, d);
  const current = () => w.wifi?.current?.() || null;
  const doFetch = (...a) => (api.fetchImpl || globalThis.fetch)(...a);
  api.setFetch = (f) => { api.fetchImpl = f; };
  api.setWebSocket = (c) => { api.WebSocketImpl = c; };
  api.lastHttp = () => api.httpLog[api.httpLog.length - 1];

  // ---- DNS ----
  const synth = new Map(), reverse = new Map();
  function resolve(name, router) {
    name = String(name).toLowerCase();
    if (isIp(name)) return name;
    const h = router.hosts.get(name);
    if (h?.ip) return h.ip;
    if (name === "localhost") return "127.0.0.1";
    if (router.dnsNames?.[name]) return router.dnsNames[name];
    if (router.internet) {
      if (!synth.has(name)) { let x = 0; for (const c of name) x = (x * 31 + c.charCodeAt(0)) >>> 0; const a = `203.0.113.${(x % 250) + 1}`; synth.set(name, a); reverse.set(a, name); }
      return synth.get(name);
    }
    return null;
  }
  const hostFor = (router, host) => { host = host.toLowerCase(); return router.hosts.get(host) || [...router.hosts.values()].find((h) => h.ip && h.ip === host); };

  // ---- HTTP ----
  const norm = (h) => { const o = {}; for (const [k, v] of Object.entries(h || {})) o[k.toLowerCase()] = String(v); return o; };
  function localResponse(router, entry, req) {
    const key = `${req.method} ${req.path}`;
    let r = entry.routes?.[key] ?? entry.routes?.[req.path] ?? entry.routes?.["* " + req.path] ?? entry.handler ?? entry.routes?.["*"];
    if (typeof r === "function") r = r(req);
    if (r === undefined) r = { status: 404, body: "not found" };
    return r;
  }
  function makeBody(r) {
    let b = r.body, ct = null;
    if (b === undefined || b === null) b = new Uint8Array(0);
    else if (typeof b === "string") b = te.encode(b);
    else if (!(b instanceof Uint8Array)) { b = te.encode(JSON.stringify(b)); ct = "application/json"; }
    return { b, ct };
  }
  async function viaLocal(router, entry, req, timeoutMs) {
    let r = await localResponse(router, entry, req);
    if (r.stall) { await w.sleep(timeoutMs + 100); return { error: "timeout" }; }
    if (r.delayMs) await w.sleep(r.delayMs);
    const { b, ct } = makeBody(r);
    let status = r.status ?? 200, body = b; const headers = norm(r.headers);
    if (ct && !headers["content-type"]) headers["content-type"] = ct;
    const rng = req.headers["range"];
    if (rng && r.status === undefined && r.ranges !== false && req.method === "GET") {
      const m = /^bytes=(\d*)-(\d*)$/.exec(rng);
      if (m) {
        let a = m[1] === "" ? Math.max(0, b.length - Number(m[2])) : Number(m[1]), z = m[1] === "" || m[2] === "" ? b.length - 1 : Math.min(Number(m[2]), b.length - 1);
        if (a >= b.length || a > z) { status = 416; body = new Uint8Array(0); headers["content-range"] = `bytes */${b.length}`; }
        else { status = 206; body = b.slice(a, z + 1); headers["content-range"] = `bytes ${a}-${z}/${b.length}`; }
      }
    }
    if (!headers["content-length"] && !r.chunked) headers["content-length"] = String(body.length);
    if (req.method === "HEAD") { body = new Uint8Array(0); }
    let pos = 0, cut = r.truncateAfter ?? Infinity;
    return {
      status, headers, via: "local",
      async pull(max) { if (pos >= body.length) return { state: 1, data: new Uint8Array(0) }; if (pos >= cut) return { state: 2, data: new Uint8Array(0) }; const e = Math.min(body.length, pos + max, cut); const d = body.slice(pos, e); pos = e; return { state: pos >= body.length ? 1 : 0, data: d }; },
      close() {},
    };
  }
  async function viaFetch(router, req, noredir, timeoutMs) {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), timeoutMs); tm.unref?.();
    let res;
    try {
      const init = { method: req.method, headers: req.headers, redirect: noredir ? "manual" : "follow", signal: ac.signal };
      if (!["GET", "HEAD"].includes(req.method) && req.body.length) init.body = req.body;
      let url = req.url;
      // a host the router's DNS maps to an address is fetched by address
      res = await doFetch(url, init);
    } catch (e) {
      clearTimeout(tm);
      if (ac.signal.aborted) { w.note(`http: ${req.url} timed out after ${timeoutMs} ms`); emit("unreachable", { url: req.url, why: "timeout" }); return { error: "timeout" }; }
      const origin = globalThis.location?.origin;
      if (origin && e instanceof TypeError && !req.url.startsWith(origin)) {
        let reachable = false;
        try { await doFetch(req.url, { mode: "no-cors", method: "GET", signal: AbortSignal.timeout(Math.min(timeoutMs, 4000)) }); reachable = true; } catch {}
        if (reachable) {
          const msg = `CORS: the browser refused ${req.url}: the server answered, but its response lacks Access-Control-Allow-Origin for ${origin} (or a preflight failed). The firmware sees an unreachable host; use a router local host, a CORS-enabled server or a proxy`;
          w.note(msg); console.warn("[dotbench net] " + msg);
          api.corsLog.push({ url: req.url, origin, msg }); emit("cors", { url: req.url, origin });
          return { error: "cors" };
        }
      }
      const why = e?.cause?.code || e?.message || String(e);
      w.note(`http: ${req.url} unreachable (${why})`); emit("unreachable", { url: req.url, why });
      return { error: "unreachable" };
    }
    clearTimeout(tm);
    const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    let status = res.status;
    if (res.type === "opaqueredirect") { status = 302; w.note(`http: ${req.url} redirected and auto-redirect is off; the browser hides the redirect target, reporting 302 without headers`); }
    const reader = res.body?.getReader?.();
    let buf = new Uint8Array(0), eof = !reader, err = false, busy = null;
    const fill = (ms) => {
      if (eof || err || buf.length) return Promise.resolve();
      busy ||= Promise.race([reader.read().then(({ done, value }) => { busy = null; if (done) eof = true; else { const n = new Uint8Array(buf.length + value.length); n.set(buf); n.set(value, buf.length); buf = n; } }, () => { busy = null; err = true; }), w.sleep(ms)]);
      return busy;
    };
    return {
      status, headers, via: "fetch",
      async pull(max, ms) { await fill(ms); if (buf.length) { const d = buf.slice(0, max); buf = buf.slice(d.length); return { state: eof && !buf.length ? 1 : 0, data: d }; } if (err) return { state: 2, data: new Uint8Array(0) }; return { state: eof ? 1 : 0, data: new Uint8Array(0) }; },
      close() { try { reader?.cancel(); } catch {} },
    };
  }

  const ops = {
    "net.http_do": async (r) => {
      const id = r.u32(), method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"][r.u8()] || "GET", noredir = !!r.u8(), timeout = r.u32(), url = r.str();
      const nh = r.u16(), headers = {};
      for (let i = 0; i < nh; i++) { const k = r.str(), v = r.str(); headers[k.toLowerCase()] = v; }
      const body = r.bytes(r.u32());
      const router = current();
      const log = { method, url, headers, body, status: 0, via: null };
      api.httpLog.push(log); if (api.httpLog.length > 300) api.httpLog.shift();
      if (!router) { w.note(`http: ${method} ${url}: no network`); return E_CONNECT; }
      let u; try { u = new URL(url); } catch { return E_CONNECT; }
      const req = { method, url, host: u.hostname, port: Number(u.port) || (u.protocol === "https:" ? 443 : 80), path: u.pathname, query: u.search.slice(1), headers, body, secure: u.protocol === "https:" };
      if (u.protocol !== "http:" && u.protocol !== "https:") return E_CONNECT;
      const entry = hostFor(router, u.hostname);
      let s;
      if (entry && (!entry.ports || entry.ports.includes(req.port))) {
        if (entry.down) { emit("unreachable", { url, why: "host down" }); return E_CONNECT; }
        if (entry.upstream) {   // a local host that forwards to a real server (a test server on 127.0.0.1): the name and port are the firmware's, the bytes are the server's
          const up = new URL(entry.upstream);
          const fwd = { ...req, url: up.origin + u.pathname + u.search };
          s = await viaFetch(router, fwd, noredir, timeout);
        } else s = await viaLocal(router, entry, req, timeout);
        if (entry.latencyMs) await w.sleep(entry.latencyMs);
      } else if (router.internet) s = await viaFetch(router, req, noredir, timeout);
      else { w.note(`http: ${url} unreachable: the router has no internet and no local host '${u.hostname}'`); emit("unreachable", { url, why: "no internet" }); return E_CONNECT; }
      if (s.error) return s.error === "timeout" ? E_FETCH_HEADER : E_CONNECT;
      if (current() !== router) { s.close?.(); w.note(`http: ${url}: the network went away before the answer arrived`); emit("unreachable", { url, why: "network lost" }); return E_CONNECT; }
      s.router = router;
      sessions.set(id, s);
      log.status = s.status; log.via = s.via; log.responseHeaders = s.headers;
      emit("http", { method, url, status: s.status, via: s.via });
      const cl = s.headers["content-length"];
      const enc = s.headers["content-encoding"];
      const chunked = cl === undefined || (enc && enc !== "identity");
      const complete = (method === "HEAD" || s.status === 204 || s.status === 304 || cl === "0");
      const keep = !/close/i.test(s.headers["connection"] || "");
      const o = new w.W().u32(s.status).u32(chunked ? 0 : Number(cl)).u8((chunked ? 1 : 0) | (keep ? 2 : 0) | (complete ? 4 : 0));
      const ents = Object.entries(s.headers).slice(0, 60);
      o.u16(ents.length);
      for (const [k, v] of ents) o.str(k).str(String(v).slice(0, 1024));
      const out = o.done();
      return { rc: 0, out: out.length > 20000 ? new w.W().u32(s.status).u32(chunked ? 0 : Number(cl)).u8((chunked ? 1 : 0) | (keep ? 2 : 0) | (complete ? 4 : 0)).u16(0).done() : out };
    },
    "net.http_read": async (rd) => {
      const id = rd.u32(), max = rd.u32(), ms = rd.u32();
      const s = sessions.get(id);
      if (!s || current() !== s.router) { if (s) { s.close?.(); sessions.delete(id); } return { rc: 0, out: Uint8Array.from([2]) }; }
      const r = await s.pull(Math.min(max, 16384), Math.max(ms, 1));
      if (r.state !== 0 && s.status !== undefined) { /* final */ }
      return { rc: 0, out: Uint8Array.from([r.state, ...r.data]) };
    },
    "net.http_close": (r) => { const id = r.u32(); const s = sessions.get(id); if (s) { s.close(); sessions.delete(id); } return 0; },

    "net.dns": (r) => {
      const name = r.str(), router = current();
      if (!router) return -1;
      const ip = resolve(name, router);
      if (!ip) { emit("unreachable", { url: name, why: "dns" }); return -1; }
      return { rc: 0, out: new w.W().u32(ip2u32(ip)).done() };
    },

    "net.udp_send": (r) => {
      const ip = u32ip(r.u32()), port = r.u16(), data = r.rest(), router = current();
      if (!router) return -1;
      api.udpLog.push({ ip, port, data });
      if (api.udpLog.length > 300) api.udpLog.shift();
      const peer = router.udpPeers.find((p) => p.ip === ip && p.port === port);
      emit("udp", { to: ip, port, bytes: data.length, peer: !!peer });
      if (peer) { peer.received.push(data); try { peer.handler?.(data, { ip, port, router }); } catch (e) { w.note("udp peer: " + e.message); } }
      return 0;   // UDP is fire and forget: a datagram to nobody is still "sent"
    },

    "ping.start": (r) => {
      const id = r.u32(), ip = u32ip(r.u32()), count = r.u32(), interval = r.u32(), timeout = r.u32(), ttl = r.u8();
      const router = current();
      const sc = w.timing.pingScale || 1;
      const s = { stopped: false, timers: [] };
      pings.set(id, s);
      const ev = (kind, seq, ms) => w.emit("ping.event", new w.W().u32(id).u8(kind).u16(seq).u32(ms).u8(ttl).done());
      (async () => {
        for (let seq = 1; seq <= count && !s.stopped; seq++) {
          const t0 = Date.now();
          const rt = router ? await pingTarget(router, ip, timeout) : null;
          if (s.stopped) break;
          if (rt !== null) { await w.sleep(Math.max(0, rt) * 1); ev(0, seq, Math.max(1, Math.round(rt))); emit("ping", { ip, ok: true }); }
          else { await w.sleep(timeout * sc); ev(1, seq, 0); emit("ping", { ip, ok: false }); }
          const left = interval * sc - (Date.now() - t0);
          if (seq < count && left > 0) await w.sleep(left);
        }
        ev(2, 0, 0); pings.delete(id);
      })();
      return 0;
    },
    "ping.stop": (r) => { const id = r.u32(); const s = pings.get(id); if (s) { s.stopped = true; w.emit("ping.event", new w.W().u32(id).u8(2).u16(0).u32(0).u8(0).done()); pings.delete(id); } return 0; },

    "sntp.start": () => { sntp = true; trySntp(); return 0; },
    "sntp.stop": () => { sntp = false; return 0; },
  };
  /** Echo reply time in ms, or null. Router host table first; then a fetch no-cors reachability check (an approximation of ICMP). */
  async function pingTarget(router, ip, timeout) {
    if (!router.on) return null;
    if (ip === router.gateway || ip === router.ip) return router.latencyMs;
    const h = [...router.hosts.values()].find((x) => x.ip === ip);
    if (h) return h.down ? null : (h.latencyMs ?? router.latencyMs) + 2;
    if (!router.internet) return null;
    const name = reverse.get(ip) || ip;
    if (typeof globalThis.fetch !== "function") return null;
    const t0 = Date.now();
    try { await doFetch((ip === "127.0.0.1" ? "http://127.0.0.1" : "http://" + name) + "/", { mode: "no-cors", method: "HEAD", signal: AbortSignal.timeout(Math.min(timeout, 3000)) }); return Date.now() - t0; }
    catch (e) { if (e?.name === "TypeError" && e?.cause?.code === "ECONNREFUSED") return Date.now() - t0; return null; }
  }
  function trySntp() {
    const router = current();
    if (!sntp || !router || !router.internet) return;
    w.after(80, () => { if (sntp && current()?.internet) w.emit("sntp.time", new w.W().u32(Math.floor(Date.now() / 1000)).done()); });
  }

  // ---- MQTT ----
  /** mqtt://h:p -> ws://h:p, mqtts:// -> wss://, ws(s):// as given. Path and port are kept: a broker's WebSocket listener is usually a different port than 1883. */
  api.mqttUrl = (uri) => {
    const m = /^(mqtt|mqtts|ws|wss|tcp|ssl):\/\/([^/:]+)(?::(\d+))?(\/.*)?$/i.exec(uri);
    if (!m) return null;
    const sec = /^(mqtts|wss|ssl)$/i.test(m[1]);
    const tcp = /^(mqtt|mqtts|tcp|ssl)$/i.test(m[1]);
    const port = m[3] || (tcp ? (sec ? "8883" : "1883") : (sec ? "443" : "80"));
    return { url: `${sec ? "wss" : "ws"}://${m[2]}:${port}${m[4] || ""}`, host: m[2], port: Number(port), secure: sec };
  };
  const brokerFor = (router, host) => {
    if (!router) return null;
    if (!router.internet) return router.broker || (router.broker = new Broker());   // internet off: the in-page broker, always
    if (router.broker && (router.broker.hosts.includes(host) || host === router.gateway || host === "broker.local")) return router.broker;
    return null;
  };
  api.brokerOf = (router) => router.broker;

  class Client {
    constructor(id, o) { Object.assign(this, o); this.id = id; this.state = "idle"; this.nextMsg = 0; this.pending = new Map(); this.timer = null; this.stopped = true; this.conn = null; this.gen = 0; }
    ev(code, bytes = []) { w.emit("mqtt.event", new w.W().u32(this.id).u8(code).bytes(bytes).done()); }
    log(s) { api.mqttLog.push(s); emit("mqtt", { state: s, id: this.id }); }
    start() {
      this.stopped = false; this.attempt();
    }
    attempt() {
      if (this.stopped) return;
      const gen = ++this.gen;
      this.state = "connecting";
      const router = current();
      let t = api.mqttUrl(this.uri);
      const mapped = t && router?.brokerMap?.get(`${t.host}:${t.port}`);
      if (mapped) t = { ...api.mqttUrl(mapped), host: t.host, port: t.port, mapped: true };
      const fail = (type, code = 0, why = "") => {
        if (gen !== this.gen) return;
        this.log("fail " + why); w.note(`mqtt ${this.uri}: ${why}`);
        this.conn = null; this.state = "idle";
        this.ev(0, [type, code]);
        this.ev(2);
        this.redial();
      };
      if (!t || !router) { setTimeout(() => fail(1, 0, !router ? "no network" : "bad uri"), 0); return; }
      const keepalive = this.keepalive || 120;
      const hello = { type: T.CONNECT, level: 4, clientId: this.clientId, clean: !this.keep, keepalive, username: this.user || undefined, password: this.pass || undefined, will: this.willTopic ? { topic: this.willTopic, payload: this.willMsg, qos: this.willQos, retain: this.willRetain } : undefined };
      const onPacket = (p) => {
        if (gen !== this.gen) return;
        switch (p.type) {
          case T.CONNACK:
            if (p.code !== 0) { this.conn.close(); fail(2, p.code, "connection refused, code " + p.code); return; }
            this.state = "up"; this.log("connected"); this.ev(1, [p.sessionPresent ? 1 : 0]);
            this.timer = setInterval(() => this.conn?.send({ type: T.PINGREQ }), Math.max(1000, keepalive * 500)); this.timer.unref?.();
            break;
          case T.PUBLISH:
            if (p.qos === 1) this.conn.send({ type: T.PUBACK, id: p.id });
            this.ev(6, new w.W().lp(te.encode(p.topic)).u8(p.retain ? 1 : 0).u8(p.qos).u32(p.payload.length).bytes(p.payload).done());
            break;
          case T.PUBACK: this.ev(5, new w.W().u32(p.id).done()); break;
          case T.SUBACK: this.ev(3, new w.W().u32(p.id).done()); break;
          case T.UNSUBACK: this.ev(4, new w.W().u32(p.id).done()); break;
          default: break;
        }
      };
      const onClose = (clean) => {
        if (gen !== this.gen) return;
        clearInterval(this.timer);
        const was = this.state === "up";
        this.conn = null; this.state = "idle";
        if (was) { this.log("lost"); this.ev(2); this.redial(); } else if (this.state === "connecting") { /* handled by fail */ }
      };
      const broker = t.mapped ? null : brokerFor(router, t.host);
      if (broker) {
        // in-page: packets travel as objects, but only after a macrotask hop so the broker never re-enters the caller
        let handler;
        const tr = { send: (p) => setTimeout(() => gen === this.gen && onPacket(p), 0), close: () => setTimeout(() => onClose(true), 0) };
        handler = broker.accept(tr);
        this.conn = { send: (p) => setTimeout(() => handler.packet(p), 0), close: () => { handler.closed(true); } };
        this.conn.kill = () => handler.closed(false);
        setTimeout(() => handler.packet(hello), 0);
        return;
      }
      if (!router.internet && !t.mapped) { setTimeout(() => fail(1, 0, "no internet and no in-page broker"), 0); return; }
      const WS = api.WebSocketImpl || globalThis.WebSocket;
      if (!WS) { setTimeout(() => fail(1, 0, "no WebSocket in this environment"), 0); return; }
      let ws;
      try { ws = new WS(t.url, "mqtt"); ws.binaryType = "arraybuffer"; } catch (e) { setTimeout(() => fail(1, 0, "WebSocket: " + e.message), 0); return; }
      const dec = decoder();
      let opened = false;
      this.conn = { send: (p) => { try { ws.send(encodePacket(p)); } catch {} }, close: () => { try { ws.close(); } catch {} } };
      ws.onopen = () => { opened = true; this.conn?.send(hello); };
      ws.onmessage = (m) => { try { for (const p of dec(new Uint8Array(m.data instanceof ArrayBuffer ? m.data : m.data.buffer ? m.data.buffer : m.data))) onPacket(p); } catch (e) { w.note("mqtt decode: " + e.message); } };
      ws.onerror = () => { if (!opened) fail(1, 0, `WebSocket ${t.url} would not open (the broker must speak MQTT over WebSocket on that port; mqtt:// is mapped to ws://)`); };
      ws.onclose = () => { if (!opened && this.state === "connecting") { fail(1, 0, `WebSocket ${t.url} closed before opening`); } else onClose(false); };
    }
    redial() {
      if (this.stopped || !this.auto) return;
      const ms = w.timing.mqttReconnectMs ?? this.reconnectMs;
      this.state = "connecting";
      const gen = this.gen;
      w.after(ms, () => { if (!this.stopped && gen === this.gen) this.attempt(); });
    }
    stop() {
      const was = this.state === "up";
      this.stopped = true; this.gen++; clearInterval(this.timer);
      if (this.conn) { try { this.conn.send({ type: T.DISCONNECT }); } catch {} const c = this.conn; setTimeout(() => c.close(), 0); this.conn = null; }
      this.state = "idle";
      if (was) this.ev(2);
    }
  }
  const cli = (r) => clients.get(r.u32());
  Object.assign(ops, {
    "mqtt.init": (r) => {
      const id = r.u32(), uri = r.str(), clientId = r.str(), user = r.str(), pass = r.str();
      const keep = !!r.u8(), proto = r.u8(), auto = !!r.u8(), willTopic = r.str(), willMsg = r.lp(), willQos = r.u8(), willRetain = !!r.u8(), reconnectMs = r.u32(), keepalive = r.u16();
      if (!api.mqttUrl(uri)) return -1;
      clients.set(id, new Client(id, { uri, clientId: clientId || "esp32-" + id.toString(16).padStart(6, "0"), user, pass, keep, proto, auto, willTopic, willMsg, willQos, willRetain, reconnectMs, keepalive }));
      return 0;
    },
    "mqtt.prop": (r) => { const c = cli(r); if (!c) return -1; c.expiry = r.u32(); c.receiveMax = r.u16(); if (c.proto === 5) w.note("mqtt: MQTT 5 connect properties are accepted; the wire is 3.1.1"); return 0; },
    "mqtt.start": (r) => { const c = cli(r); if (!c) return -1; c.start(); return 0; },
    "mqtt.stop": (r) => { const c = cli(r); if (!c) return -1; c.stop(); return 0; },
    "mqtt.destroy": (r) => { const c = cli(r); if (c) { c.stop(); clients.delete(c.id); } return 0; },
    "mqtt.publish": (r) => {
      const c = cli(r); if (!c) return -1;
      const qos = r.u8(), retain = !!r.u8(), topic = r.str(), payload = r.rest();
      if (c.state !== "up" || !c.conn) return -1;
      const id = qos ? (c.nextMsg = (c.nextMsg % 65535) + 1) : 0;
      c.conn.send({ type: T.PUBLISH, topic, payload, qos: Math.min(qos, 1), retain, id });
      return id;
    },
    "mqtt.subscribe": (r) => { const c = cli(r); if (!c) return -1; const qos = r.u8(), topic = r.str(); if (c.state !== "up") return -1; const id = (c.nextMsg = (c.nextMsg % 65535) + 1); c.conn.send({ type: T.SUBSCRIBE, id, subs: [{ filter: topic, qos }] }); return id; },
    "mqtt.unsubscribe": (r) => { const c = cli(r); if (!c) return -1; r.u8(); const topic = r.str(); if (c.state !== "up") return -1; const id = (c.nextMsg = (c.nextMsg % 65535) + 1); c.conn.send({ type: T.UNSUBSCRIBE, id, filters: [topic] }); return id; },
  });
  api.mqttClients = () => [...clients.values()].map((c) => ({ id: c.id, uri: c.uri, state: c.state, clientId: c.clientId }));

  const attach = (world) => {
    w = world;
    for (const [k, f] of Object.entries(ops)) w.op(k, f);
    w.net = api;
    Object.assign(w.routerProto, {
      host(name, spec = {}) { const e = { ...spec, name: name.toLowerCase() }; this.hosts.set(e.name, e); if (e.ip) { try { ip2u32(e.ip); } catch { throw new Error("bad ip"); } } return e; },
      removeHost(name) { this.hosts.delete(name.toLowerCase()); },
      udpPeer(ip, port, handler) { const p = { ip, port, handler, received: [], send(bytes) { w.note(`udp peer ${ip}:${port} sent ${bytes.length} bytes to the device: the SDK has no UDP receive path, dropped`); api.udpLog.push({ undelivered: true, ip, port, data: bytes }); } }; this.udpPeers.push(p); return p; },
      /** Send mqtt://host:port to a real WebSocket broker at wsUrl (e.g. a test broker on 127.0.0.1), whatever the internet switch says. */
      mapBroker(host, port, wsUrl) { (this.brokerMap ||= new Map()).set(`${host}:${port}`, wsUrl); },
      enableBroker(opts = {}) { this.broker?.close?.(); this.broker = new Broker(opts); return this.broker; },
    });
    w.wifi?.listen?.(() => {});
    w.listeners.add((type) => { if (type === "got-ip") trySntp(); });
  };
  withWorld(M, attach);
  return api;
}
