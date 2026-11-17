// SPDX-License-Identifier: GPL-3.0-or-later
// Loads the toolchain assets and installs them where the patched clang-runtime.js looks (globalThis.__CC_ASSETS__).
// Browser: fetch + Cache API (offline after the first load). Node: files from a directory.
import { unpack, toTree } from "./pack.js";

const MODULES = ["llvm.core.wasm", "llvm.core2.wasm", "llvm.core3.wasm", "llvm.core4.wasm"];

/** @param {{base: string, cacheName?: string, onProgress?: Function}} o  base = URL (browser) or directory path (node, ends with /) of the cc asset folder */
export async function installAssets({ base, cacheName = "dotbench-cc-v1", onProgress = () => {} }) {
  const isNode = typeof process !== "undefined" && !!process.versions?.node && typeof WorkerGlobalScope === "undefined";
  const stats = { fetched: {}, fromCache: {}, ms: {} };
  let getResponse;
  if (isNode) {
    const fs = await import("node:fs/promises");
    getResponse = async (name) => new Response(await fs.readFile(base + name), { headers: { "content-type": name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" } });
  } else {
    const cache = typeof caches !== "undefined" ? await caches.open(cacheName) : null;
    getResponse = async (name) => {
      const url = new URL(name, base).href;
      const hit = cache && (await cache.match(url));
      if (hit) { stats.fromCache[name] = true; return hit; }
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
      stats.fetched[name] = Number(r.headers.get("content-length") ?? 0);
      if (cache) await cache.put(url, r.clone());
      return r;
    };
  }
  const timed = async (name, f) => { const t = performance.now(); const v = await f(); stats.ms[name] = Math.round(performance.now() - t); onProgress(name, stats.ms[name]); return v; };
  globalThis.__CC_ASSETS__ = {
    modules: async () => {
      const entries = await Promise.all(MODULES.map((n) => timed(n, async () => {
        const r = await getResponse(n);
        return [n, WebAssembly.compileStreaming ? await WebAssembly.compileStreaming(r) : await WebAssembly.compile(await r.arrayBuffer())];
      })));
      return Object.fromEntries(entries);
    },
    filesystem: async () => {
      const tree = {};
      for (const n of ["inc.pack", "lib.pack"]) await timed(n, async () => { const r = await getResponse(n); toTree(unpack(new Uint8Array(await r.arrayBuffer())), tree); });
      return tree;
    },
  };
  return stats;
}
