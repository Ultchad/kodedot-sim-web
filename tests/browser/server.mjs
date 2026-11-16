// Tiny static server for the browser test: cross-origin isolation headers (COOP/COEP/CORP) and a strict CSP.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../..");
const buildDir = () => process.env.DOTBENCH_BUILD || path.join(root, "build");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".dotbench": "application/zip", ".json": "application/json" };

export const CSP = [
  "default-src 'none'",
  "script-src 'self' blob: 'wasm-unsafe-eval'",   // blob: = the module the adapter builds from the package
  "worker-src blob:",                              // pthreads are blob workers
  "connect-src 'self' blob:",
  "style-src 'unsafe-inline'", "img-src 'self' data: blob:",
].join("; ");

export function startServer(port = 0) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let file = null;
    if (u.pathname === "/") file = path.join(here, "page.html");
    else if (u.pathname === "/page.js") file = path.join(here, "page.js");
    else if (u.pathname.startsWith("/adapter/")) file = path.join(root, "runtime/web-adapter", path.basename(u.pathname));
    else if (u.pathname.startsWith("/pkg/")) { const n = path.basename(u.pathname, ".dotbench"); file = path.join(buildDir(), "apps", n, n + ".dotbench"); }
    const h = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": CSP,
      "Cache-Control": "no-store",
    };
    if (!file || !fs.existsSync(file)) { res.writeHead(404, h); res.end("not found"); return; }
    res.writeHead(200, { ...h, "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ srv, url: "http://127.0.0.1:" + srv.address().port })));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { url } = await startServer(Number(process.env.PORT || 8099));
  console.log("serving", url);
}
