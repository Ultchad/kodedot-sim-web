// Node host with persistence, for the persistence/storage/sd/time/nvs tests. It follows the same boot sequence as
// tests/node/harness.mjs and runtime/web-adapter (instantiate with noInitialRun, boot block, regions, callMain) but
// loads and saves the persistent regions through runtime/web-adapter/persist.js + persist-node.js, so what survives a
// "restart" is what a real mirror would have stored: a directory on disk.
import { watchThreads } from "../../../runtime/web-adapter/thread-watch.js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OFF, RESET, sleep, packageFactory, installFactory } from "../harness.mjs";
import { PersistManager } from "../../../runtime/web-adapter/persist.js";
import { NodeDirBackend } from "../../../runtime/web-adapter/persist-node.js";

export { OFF, RESET, sleep, PersistManager, NodeDirBackend };
const here = path.dirname(new URL(import.meta.url).pathname);
export const root = path.resolve(here, "../../..");
export const buildDir = () => process.env.DOTBENCH_BUILD || path.join(root, "build");
export const sdkDir = () => process.env.DOTBENCH_SDK || "/home/claude/src/kode-sdk";
export const pkgPath = (name) => path.join(buildDir(), "apps", name, name + ".dotbench");
export const tmpDir = (p = "dbp-") => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Build (or rebuild) a test app from a directory with CMakeLists.txt + main/ (tools/dotbench build reads only those). */
export function buildApp(appDir) {
  const out = execFileSync(path.join(root, "tools/dotbench"), ["--build", buildDir(), "build", appDir], { encoding: "utf8", env: process.env });
  const m = /dotbench build: (.*\.dotbench)/.exec(out);
  if (!m) throw new Error("build failed: " + out);
  return m[1];
}
/** Assemble a throw-away app project under <build>/testapps/<name>: files = {relative path: text | Buffer | {copy: absolute path}}. */
export function assembleApp(name, files) {
  const d = path.join(buildDir(), "testapps", name);
  fs.rmSync(d, { recursive: true, force: true });
  for (const [rel, v] of Object.entries(files)) {
    const f = path.join(d, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (v && v.copy) fs.copyFileSync(v.copy, f); else fs.writeFileSync(f, v);
  }
  return d;
}
export function appProject(name, srcs, extra = {}) {
  return {
    "CMakeLists.txt": `cmake_minimum_required(VERSION 3.22)\nproject(${name})\n`,
    "main/CMakeLists.txt": `idf_component_register(SRCS ${srcs.map((s) => '"' + s + '"').join(" ")} INCLUDE_DIRS ".")\n`,
    ...extra,
  };
}

const extracted = new Map();
async function loadPkg(pkgFile) {
  const key = pkgFile + "|" + fs.statSync(pkgFile).mtimeMs;
  if (extracted.has(key)) return extracted.get(key);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotbench-"));
  execFileSync("python3", ["-I", "-c", "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", pkgFile, dir]);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const appJson = JSON.parse(fs.readFileSync(path.join(dir, "appdata/app.json"), "utf8"));
  const mod = await import(pathToFileURL(path.join(dir, manifest.js)).href);
  const r = { dir, manifest, appJson, mod };
  extracted.set(key, r);
  return r;
}
const putStr = (HEAPU8, p, n, str) => { const b = Buffer.from(str, "utf8").subarray(0, n - 1); HEAPU8.fill(0, p, p + n); HEAPU8.set(b, p); };

/** A simulated device: one persistence directory, any number of boots. */
export class Bench {
  /** @param {{dir?: string, memory?: boolean}} o */
  constructor(o = {}) {
    this.dir = o.dir ?? tmpDir();
    this.backend = o.memory ? null : new NodeDirBackend(this.dir);
    this.events = [];
    this.pm = new PersistManager({ backend: this.backend, onEvent: (t, d) => this.events.push([t, d]) });
    this.bootCount = 0;
    this.opened = false;
  }
  async open() { if (!this.opened) { await this.pm.open(); this.opened = true; } return this; }

  /** Power-on (reason 1) or reset (2/3): returns the running program handle. */
  async boot(pkgFile, { reason = RESET.POWERON, powerOn = reason === RESET.POWERON, factory } = {}) {
    await this.open();
    const { appJson, mod, dir: pkgDir, manifest } = await loadPkg(pkgFile);
    const logs = [];
    const M = await mod.default({ noInitialRun: true, print: (s) => logs.push("[stdout] " + s), printErr: (s) => logs.push("[stderr] " + s) });
    const threads = watchThreads(M); (globalThis.__dbThreads ??= []).push(threads);
    const statePtr = M._kweb_state();
    const dv = () => new DataView(M.HEAPU8.buffer, 0, M.HEAPU8.buffer.byteLength);
    const u32 = (off) => dv().getUint32(statePtr + off, true);
    const setU32 = (off, v) => dv().setUint32(statePtr + off, v >>> 0, true);
    setU32(OFF.bootReason, reason);
    setU32(OFF.bootCount, ++this.bootCount);
    putStr(M.HEAPU8, statePtr + OFF.bootName, 32, appJson.name);
    putStr(M.HEAPU8, statePtr + OFF.bootVersion, 32, appJson.version);
    if (powerOn) this.pm.dropRetained();
    this.pm.restoreInto(M);
    this.pm.attach(M);
    installFactory(M, factory !== undefined ? factory : packageFactory(pkgDir, manifest));
    const text = [];
    const drain = () => {
      const cap = 8192, buf = M._malloc(cap);
      for (;;) {
        const n = M._kweb_text_drain(buf, cap);
        if (!n) break;
        const bytes = M.HEAPU8.slice(buf, buf + n);
        for (let i = 0; i + 3 <= bytes.length;) {
          const ch = bytes[i], len = bytes[i + 1] | (bytes[i + 2] << 8);
          text.push({ ch, s: Buffer.from(bytes.slice(i + 3, i + 3 + len)).toString("utf8") });
          i += 3 + len;
        }
      }
      M._free(buf);
    };
    let down = false;
    const bench = this;
    const run = {
      M, bench, logs, text, drain, u32, statePtr, threads,
      /** The same context an area's JS glue gets in the page (storage.js, sd.js, nvs.js, time.js). */
      glue: (mod) => mod.default(glueCtx(M)),
      logText: () => { drain(); return text.map((t) => t.s).join(""); },
      restartRequested: () => (u32(OFF.events) & 1) !== 0,
      restartReason: () => u32(OFF.restartReason),
      button: (id, d) => M._kweb_button(id, d ? 1 : 0),
      touch: (x, y, d) => M._kweb_touch(x, y, d ? 1 : 0),
      i32: (off) => dv().getInt32(statePtr + off, true),
      frameSeq: () => u32(OFF.frameSeq),
      framebuffer: () => { const off = statePtr + u32(OFF.fbOffset); return M.HEAPU8.slice(off, off + u32(OFF.fbStride) * u32(OFF.fbH)); },
      shutdown: () => run.stop({ save: false }),
      /** Type a line on the firmware console (like dev.sendConsole). */
      console(line) {
        const bytes = Buffer.from(line + "\n"); const p = M._malloc(bytes.length);
        M.HEAPU8.set(bytes, p); M._kweb_console_input(p, bytes.length); M._free(p);
      },
      async waitFor(pred, ms, what) {
        const t0 = Date.now();
        for (;;) {
          drain();
          if (pred()) return true;
          if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what + "\n--- log ---\n" + run.logText().slice(-3000) + "\n--- stdio ---\n" + logs.slice(-20).join("\n"));
          await sleep(20);
        }
      },
      /** Dirty-chunk flush while running (what the debounce timer does). */
      flush: () => bench.pm.flush(),
      /** Stop: terminate every worker, then full-compare the regions and commit. Returns when the backend has it. */
      async stop({ save = true } = {}) {
        if (down) return;
        down = true;
        drain();
        M.PThread.terminateAllThreads();
        try { Atomics.notify(M.HEAP32, M._pthread_self() >> 2); } catch { /* gone */ }
        if (save) await bench.pm.finalize();
        bench.pm.detach();
      },
      get down() { return down; },
    };
    M.callMain([]);
    return run;
  }
}

/** A glue context over a Node module, like the adapter's _glueContext. */
export function glueCtx(M, emitted = []) {
  const ticks = [];
  return {
    module: M, call: (fn, ...a) => M["_" + fn](...a), alloc: (n) => M._malloc(n), free: (p) => M._free(p), heap: () => M.HEAPU8,
    emit: (type, data) => emitted.push([type, data]), onTick: (cb) => ticks.push(cb), ticks, emitted,
  };
}
export const glueMods = {
  storage: () => import("../../../runtime/drivers/storage/storage.js"),
  sd: () => import("../../../runtime/drivers/sd/sd.js"),
  nvs: () => import("../../../runtime/drivers/nvs/nvs.js"),
  time: () => import("../../../runtime/drivers/time/time.js"),
};

// Every program a test boots must stay inside its worker pool: beyond it a thread creation needs the page's event loop (docs/STATUS-panic.md).
if (!globalThis.__dbThreadsHook) {
  globalThis.__dbThreadsHook = true;
  process.on("exit", (code) => {
    const all = globalThis.__dbThreads ?? [];
    const over = all.filter((t) => t.beyondPool > 0);
    if (process.env.DB_THREADS_LOG) console.log("threads: peak " + Math.max(0, ...all.map((t) => t.peak)) + " of pool " + Math.max(0, ...all.map((t) => t.pool)) + " over " + all.length + " boot(s)");
    const tight = all.filter((t) => t.peak > 0.8 * t.pool);
    if (tight.length) { console.log("FAIL - a program used more than 80 % of its worker pool (peak " + Math.max(...tight.map((t) => t.peak)) + " of " + tight[0].pool + "): grow the pool (tools/dblib/kodeos.py POOL, tools/dotbench --pool)"); process.exitCode = code || 1; }
    if (over.length) { console.log("FAIL - a program created " + over.reduce((n, t) => n + t.beyondPool, 0) + " thread(s) beyond its worker pool (peak " + Math.max(...over.map((t) => t.peak)) + " of " + over[0].pool + ")"); process.exitCode = code || 1; }
  });
}
