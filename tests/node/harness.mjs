// Test harness: unpack a .dotbench, boot it under Node, and give tests the bridge.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// kweb_state_t byte offsets (runtime/bridge/README.md)
export const OFF = {
  magic: 0x00, abi: 0x04, events: 0x0c,
  fbW: 0x10, fbH: 0x14, fbStride: 0x1c, fbOffset: 0x20, frameSeq: 0x24, panelOn: 0x30, backlight: 0x34, flushes: 0x38,
  ledRgb: 0x50, ledSeq: 0x54,
  bootReason: 0xb0, bootCount: 0xb4, restartReason: 0xb8, restartSeq: 0xbc, restartTarget: 0xc0, bootName: 0xe0, bootVersion: 0x100,
  buttons: 0x70, touchX: 0x74, touchY: 0x78, touchDown: 0x7c, touchSeq: 0x80,
};
export const BTN = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, TOP: 4, BOT: 5 };

const here = path.dirname(new URL(import.meta.url).pathname);
/** Path of a built example/test app package: $DOTBENCH_BUILD/apps/<name>/<name>.dotbench */
export const pkgPath = (name) =>
  path.join(process.env.DOTBENCH_BUILD || path.join(here, "../../build"), "apps", name, name + ".dotbench");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const extracted = new Map();   // pkg path + mtime -> {dir, manifest, appJson, mod}

async function load(pkgFile) {
  const key = pkgFile + "|" + fs.statSync(pkgFile).mtimeMs;
  if (extracted.has(key)) return extracted.get(key);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotbench-"));
  execFileSync("python3", ["-I", "-c",
    "import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", pkgFile, dir]);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const appJson = JSON.parse(fs.readFileSync(path.join(dir, "appdata/app.json"), "utf8"));
  const mod = await import(pathToFileURL(path.join(dir, manifest.js)).href);
  const r = { dir, manifest, appJson, mod };
  extracted.set(key, r);
  return r;
}

const RESET = { POWERON: 1, EXTERNAL: 2, SOFTWARE: 3, PANIC: 4 };
export { RESET };
const cstr = (HEAPU8, p, n) => { let e = p; while (e < p + n && HEAPU8[e]) e++; return Buffer.from(HEAPU8.slice(p, e)).toString("utf8"); };
const putStr = (HEAPU8, p, n, str) => { const b = Buffer.from(str, "utf8").subarray(0, n - 1); HEAPU8.fill(0, p, p + n); HEAPU8.set(b, p); };

/**
 * Boot a .dotbench in this process. opts: { reason, persist: Map(name -> Uint8Array), bootCount }.
 * The same sequence the browser adapter uses: instantiate with noInitialRun, write the boot block and
 * the persisted regions into the fresh memory, then callMain().
 */
export async function boot(pkgFile, opts = {}) {
  const { dir, manifest, appJson, mod } = await load(pkgFile);
  const logs = [];
  const M = await mod.default({
    noInitialRun: true,
    print: (s) => logs.push("[stdout] " + s),
    printErr: (s) => logs.push("[stderr] " + s),
  });
  const statePtr = M._kweb_state();
  const dv = () => new DataView(M.HEAPU8.buffer, 0, M.HEAPU8.buffer.byteLength);
  const u32 = (off) => dv().getUint32(statePtr + off, true);
  const i32 = (off) => dv().getInt32(statePtr + off, true);
  const setU32 = (off, v) => dv().setUint32(statePtr + off, v >>> 0, true);

  // boot block + persisted regions, before the program runs
  setU32(OFF.bootReason, opts.reason ?? RESET.POWERON);
  setU32(OFF.bootCount, opts.bootCount ?? 1);
  putStr(M.HEAPU8, statePtr + OFF.bootName, 32, appJson.name);
  putStr(M.HEAPU8, statePtr + OFF.bootVersion, 32, appJson.version);
  const regionNames = [];
  for (let i = 0; i < M._kweb_persist_count(); i++) {
    const name = cstr(M.HEAPU8, M._kweb_persist_name(i), 16);
    regionNames.push(name);
    const saved = opts.persist?.get(name);
    if (saved && saved.length === M._kweb_persist_size(i)) M.HEAPU8.set(saved, M._kweb_persist_ptr(i));
  }
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
  const api = {
    M, dir, manifest, logs, text, drain, u32, i32, setU32, statePtr, regionNames,
    led: () => { const v = u32(OFF.ledRgb); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; },
    ledSeq: () => u32(OFF.ledSeq),
    frameSeq: () => u32(OFF.frameSeq),
    button: (id, d) => M._kweb_button(id, d ? 1 : 0),
    touch: (x, y, d) => M._kweb_touch(x, y, d ? 1 : 0),
    framebuffer: () => {
      const off = statePtr + u32(OFF.fbOffset);
      return M.HEAPU8.slice(off, off + u32(OFF.fbStride) * u32(OFF.fbH));
    },
    logText: () => { drain(); return text.map((t) => t.s).join(""); },
    restartRequested: () => (u32(OFF.events) & 1) !== 0,
    restartInfo: () => ({ reason: u32(OFF.restartReason), seq: u32(OFF.restartSeq), target: cstr(M.HEAPU8, statePtr + OFF.restartTarget, 32) }),
    /** Copy out the regions that survive a restart. */
    snapshot() {
      const m = new Map();
      for (let i = 0; i < M._kweb_persist_count(); i++) {
        const p = M._kweb_persist_ptr(i), n = M._kweb_persist_size(i);
        m.set(cstr(M.HEAPU8, M._kweb_persist_name(i), 16), M.HEAPU8.slice(p, p + n));
      }
      return m;
    },
    workers: () => Object.keys(M.PThread.pthreads).length + M.PThread.unusedWorkers.length,
    /** Terminate every worker of this program. The instance is unusable afterwards. */
    shutdown() {
      if (down) return;
      down = true;
      M.PThread.terminateAllThreads();
      // the main thread's Atomics.waitAsync on its mailbox would keep the whole shared memory alive
      Atomics.notify(M.HEAP32, M._pthread_self() >> 2);
    },
    async waitFor(pred, ms, what) {
      const t0 = Date.now();
      for (;;) {
        drain();
        if (pred()) return true;
        if (Date.now() - t0 > ms) throw new Error("timeout waiting for " + what + "\n--- log ---\n" + api.logText() + "\n--- stdio ---\n" + logs.join("\n"));
        await sleep(25);
      }
    },
  };
  M.callMain([]);
  return api;
}
