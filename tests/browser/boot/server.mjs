// Server for boot.test.mjs: persist-server's headers, packages and adapter files, plus this folder's page.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { CSP } from "../server.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, "../../..");
const buildDir = () => process.env.DOTBENCH_BUILD || path.join(root, "build");
const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".dotbench": "application/zip" };

export function startBootServer(port = 0) {
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    let file = null;
    if (u.pathname === "/") file = path.join(here, "boot.html");
    else if (u.pathname === "/boot-page.js") file = path.join(here, "boot-page.js");
    else if (u.pathname.startsWith("/adapter/")) file = path.join(root, "runtime/web-adapter", path.basename(u.pathname));
    else if (u.pathname.startsWith("/pkg/")) { const n = path.basename(u.pathname, ".dotbench"); file = path.join(buildDir(), "apps", n, n + ".dotbench"); }
    const h = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Resource-Policy": "same-origin",
      "Content-Security-Policy": CSP, "Cache-Control": "no-store" };
    if (!file || !fs.existsSync(file)) { res.writeHead(404, h); res.end("not found"); return; }
    res.writeHead(200, { ...h, "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ srv, url: "http://127.0.0.1:" + srv.address().port })));
}
