// SPDX-License-Identifier: GPL-3.0-or-later
// Server for cc.test.mjs: the production headers (COOP/COEP + the CSP from web/vercel.json, via ../server.mjs), the compiler assets compressed on the way out
// like Vercel's CDN does (brotli for wasm/js/json; the .pack files are served as octet-stream and are NOT compressed by Vercel, so neither are they here),
// immutable caching on content-hashed names.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import zlib from "node:zlib";
import { CSP } from "../server.mjs";
const here = path.dirname(new URL(import.meta.url).pathname), root = path.resolve(here, "../../..");
const buildDir = () => process.env.DOTBENCH_BUILD || path.join(root, "build");
export const assetsDir = () => process.env.DOTBENCH_CC_ASSETS || path.join(root, "build/cc-assets")   /* where build-assets.mjs and tests/node/cc put them, whatever DOTBENCH_BUILD is */;
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".dotbench": "application/zip", ".dotpart": "application/zip", ".json": "application/json", ".wasm": "application/wasm", ".txt": "text/plain" };
export function startCcServer(port = 0) {
  const stats = { cc: [], ccBytes: 0, all: [] }, brCache = new Map();
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"); let file = null;
    if (u.pathname === "/") file = path.join(here, "page.html");
    else if (u.pathname === "/page.js") file = path.join(here, "page.js");
    else if (u.pathname === "/cc-client.js") file = path.join(root, "runtime/cc/index.js");
    else if (u.pathname.startsWith("/cc/")) file = path.join(assetsDir(), u.pathname.slice(4));
    else if (u.pathname.startsWith("/adapter/")) file = path.join(root, "runtime/web-adapter", path.basename(u.pathname));
    else if (u.pathname.startsWith("/parts/")) file = path.join(root, "parts/dist", path.basename(u.pathname));
    else if (u.pathname.startsWith("/pkg/")) { const n = path.basename(u.pathname, ".dotbench"); file = path.join(buildDir(), "apps", n, n + ".dotbench"); }
    const h = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": CSP,
      "Cache-Control": u.pathname.startsWith("/cc/") && u.pathname !== "/cc/manifest.json" ? "public, max-age=31536000, immutable" : "no-store" };
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, h); res.end("not found"); return; }
    let body = fs.readFileSync(file); const ext = path.extname(file), type = TYPES[ext] ?? "application/octet-stream";
    const headers = { ...h, "Content-Type": type };
    if (u.pathname.startsWith("/cc/") && /br/.test(req.headers["accept-encoding"] ?? "") && type !== "application/octet-stream" && body.length > 1024) {
      if (!brCache.has(file)) brCache.set(file, zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } }));
      body = brCache.get(file); headers["Content-Encoding"] = "br";
    }
    headers["Content-Length"] = body.length;
    if (u.pathname.startsWith("/cc/")) { stats.cc.push(u.pathname.slice(4)); stats.ccBytes += body.length; }
    res.writeHead(200, headers); res.end(body);
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ srv, stats, url: "http://127.0.0.1:" + srv.address().port })));
}
