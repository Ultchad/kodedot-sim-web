// Local static server with the site's production headers (COOP/COEP + the CSP from web/vercel.json), for the headless Chrome demo.
//   /            page/page.html        /page.js   page/page.js
//   /adapter/*   runtime/web-adapter   /cc/*      build/site/cc (the toolchain bundle)   /example/<part>/<file>   parts/<part>/<file>
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib"; import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const VJ = ["/home/claude/dotbench/web/vercel.json", path.join(ROOT, "web/vercel.json")].find((p) => fs.existsSync(p));
export const CSP = JSON.parse(fs.readFileSync(VJ, "utf8")).headers[0].headers.find((h) => h.key === "Content-Security-Policy").value;
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json", ".pack": "application/octet-stream" };
export function startServer({ port = 0, compress = "br", cacheControl = "no-store" } = {}) {
  const stats = { requests: [], bytes: 0 };
  const sockets = new Set(), brCache = new Map();
  // compress once up front so a measurement of a cold load is not a measurement of this server's CPU
  if (compress === "br") for (const f of fs.readdirSync(path.join(HERE, "build/site/cc"))) { const file = path.join(HERE, "build/site/cc", f), b = fs.readFileSync(file); if (b.length > 1024) brCache.set(file, zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } })); }
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); let file = null;
    if (u.pathname === "/") file = path.join(HERE, "page/page.html");
    else if (u.pathname === "/page.js") file = path.join(HERE, "page/page.js");
    else if (u.pathname === "/sw.js") file = path.join(HERE, "page/sw.js");
    else if (u.pathname.startsWith("/adapter/")) file = path.join(ROOT, "runtime/web-adapter", path.basename(u.pathname));
    else if (u.pathname.startsWith("/cc/")) file = path.join(HERE, "build/site/cc", path.basename(u.pathname));
    else if (u.pathname.startsWith("/example/")) { const [, , part, ...rest] = u.pathname.split("/"); file = path.join(ROOT, "parts", part, ...rest); }
    const h = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": CSP, "Cache-Control": cacheControl };
    if (!file || !fs.existsSync(file)) { res.writeHead(404, h); res.end("not found"); return; }
    let body = fs.readFileSync(file); const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    const accept = req.headers["accept-encoding"] ?? "";
    // like Vercel's CDN: compress compressible static files on the way out (we measure the compressed bytes)
    if (compress === "br" && /br/.test(accept) && body.length > 1024) { body = brCache.get(file) ?? (brCache.set(file, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } })), brCache.get(file)); h["Content-Encoding"] = "br"; }
    stats.requests.push(u.pathname); stats.bytes += body.length;
    res.writeHead(200, { ...h, "Content-Type": type, "Content-Length": body.length }); res.end(body);
  });
  srv.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ srv, stats, url: "http://127.0.0.1:" + srv.address().port, close: () => { srv.close(); for (const s of sockets) s.destroy(); } })));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const { url } = await startServer({ port: +process.env.PORT || 8099 }); console.log("serving " + url); }
