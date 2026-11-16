// Test servers, started inside the tests (node built-ins only): an HTTP server and a WebSocket MQTT broker.
import http from "node:http";
import crypto from "node:crypto";

/** HTTP server on 127.0.0.1:<random>. Returns { port, url, requests, close() }. */
export async function httpServer() {
  const requests = [];
  const BIG = Buffer.alloc(100000, 0).map((_, i) => 65 + (i % 26));
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const u = new URL(req.url, "http://x");
      const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
      if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
      if (u.pathname === "/hello" || u.pathname === "/") { res.writeHead(200, { ...cors, "content-type": "text/html", "x-demo": "yes" }); return res.end("<html>hello from the test server</html>"); }
      if (u.pathname === "/nocors") { res.writeHead(200, { "content-type": "text/plain" }); return res.end("no cors headers here"); }
      if (u.pathname === "/echo") { res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify({ method: req.method, headers: req.headers, body: body.toString() })); }
      if (u.pathname === "/redirect") { res.writeHead(302, { ...cors, location: "/hello" }); return res.end(); }
      if (u.pathname === "/status") { res.writeHead(Number(u.searchParams.get("code")) || 500, cors); return res.end("status page"); }
      if (u.pathname === "/chunked") {
        res.writeHead(200, { ...cors, "content-type": "text/plain" });
        let n = 0; const t = setInterval(() => { res.write(`part${n++};`); if (n === 5) { clearInterval(t); res.end(); } }, 20); return;
      }
      if (u.pathname === "/big") {
        const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
        if (m) {
          const a = Number(m[1]), z = m[2] ? Math.min(Number(m[2]), BIG.length - 1) : BIG.length - 1;
          if (a >= BIG.length) { res.writeHead(416, { ...cors, "content-range": `bytes */${BIG.length}` }); return res.end(); }
          res.writeHead(206, { ...cors, "content-range": `bytes ${a}-${z}/${BIG.length}`, "content-length": z - a + 1 }); return res.end(BIG.subarray(a, z + 1));
        }
        res.writeHead(200, { ...cors, "content-length": BIG.length, "accept-ranges": "bytes" }); return res.end(BIG);
      }
      if (u.pathname === "/stall") return;   // never answers
      if (u.pathname === "/cut") { res.writeHead(200, { ...cors, "content-length": 5000 }); res.write("x".repeat(1000)); setTimeout(() => res.destroy(), 50); return; }
      res.writeHead(404, cors); res.end("not found");
    });
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  return { port, url: `http://127.0.0.1:${port}`, requests, big: BIG, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

/** MQTT-over-WebSocket broker on 127.0.0.1:<random> (ws://127.0.0.1:port/mqtt). Hand it the Broker class and the codec of net.js. */
export async function wsBroker({ Broker, encodePacket, decoder }, opts = {}) {
  const broker = new Broker(opts);
  const srv = http.createServer((q, s) => { s.writeHead(426); s.end("upgrade required"); });
  const sockets = new Set();
  const connects = [];
  srv.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    const proto = (req.headers["sec-websocket-protocol"] || "").split(",")[0].trim();
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n${proto ? `Sec-WebSocket-Protocol: ${proto}\r\n` : ""}\r\n`);
    sockets.add(socket); connects.push({ path: req.url, proto });
    const frame = (data) => { const n = data.length; const h = n < 126 ? Buffer.from([0x82, n]) : Buffer.from([0x82, 126, n >> 8, n & 255]); socket.write(Buffer.concat([h, Buffer.from(data)])); };
    const handler = broker.accept({ send: (p) => frame(encodePacket(p)), close: () => socket.end() });
    const dec = decoder();
    let buf = Buffer.alloc(0);
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = buf[1] & 128; if (masked) off += 4;
        if (buf.length < off + len) return;
        const payload = Buffer.from(buf.subarray(off, off + len));
        if (masked) { const m = buf.subarray(off - 4, off); for (let i = 0; i < len; i++) payload[i] ^= m[i & 3]; }
        buf = buf.subarray(off + len);
        if (op === 8) { socket.end(); return; }
        if (op === 2) for (const p of dec(new Uint8Array(payload))) handler.packet(p);
      }
    });
    socket.on("close", () => { sockets.delete(socket); handler.closed(false); });
    socket.on("error", () => {});
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  return { port, ws: `ws://127.0.0.1:${port}/mqtt`, broker, connects, dropAll: () => sockets.forEach((s) => s.destroy()), close: () => new Promise((r) => { sockets.forEach((s) => s.destroy()); srv.close(r); }) };
}
