// dotbench web adapter: runs a .dotbench package (Kode Dot firmware compiled to WebAssembly) in a page.
// Framework-free ES module, no bundler needed. See README.md.
import { makeCaller } from "./page-call.js";
import { readZip } from "./zip.js";
import { PersistManager } from "./persist.js";
import { factoryEntries, packFactory, installFactory } from "./factory.js";

/** Byte offsets into the shared kweb_state_t (runtime/bridge/README.md). */
export const OFF = {
  magic: 0x00, abi: 0x04, events: 0x0c,
  fbW: 0x10, fbH: 0x14, fbStride: 0x1c, fbOffset: 0x20, frameSeq: 0x24, panelOn: 0x30, backlight: 0x34,
  ledRgb: 0x50, ledSeq: 0x54, haptic: 0x58, hapticSeq: 0x5c,
  buttons: 0x70, touchSeq: 0x80,
  textHead: 0x90, textTail: 0x94,
  bootReason: 0xb0, bootCount: 0xb4, restartReason: 0xb8, restartSeq: 0xbc, restartTarget: 0xc0,
  bootName: 0xe0, bootVersion: 0x100,
};
export const BUTTONS = { up: 0, down: 1, left: 2, right: 3, top: 4, bottom: 5, bot: 5 };
export const RESET = { UNKNOWN: 0, POWERON: 1, EXTERNAL: 2, SOFTWARE: 3, PANIC: 4, INT_WDT: 5, TASK_WDT: 6, WDT: 7, DEEPSLEEP: 8, BROWNOUT: 9 };
const RESET_NAME = Object.fromEntries(Object.entries(RESET).map(([k, v]) => [v, k.toLowerCase()]));
const EVT_RESTART = 1, EVT_PANIC = 2;
export const SCREEN_WIDTH = 410, SCREEN_HEIGHT = 502;

/** @typedef {'idle'|'booting'|'running'|'crashed'|'restart-requested'} DeviceStatus */
/** @typedef {{status: DeviceStatus, reason?: string, target?: string}} StatusDetail */
/** @typedef {{id: number, ts: number, level: 'debug'|'info'|'warn'|'error'|'input', text: string, channel: number}} LogLine */

const IS_NODE = typeof process !== "undefined" && !!process.versions?.node && typeof window === "undefined";
const nodeImport = (m) => import(/* @vite-ignore */ m);
const cstr = (u8, p, n) => { let e = p; while (e < p + n && u8[e]) e++; return new TextDecoder().decode(u8.slice(p, e)); };
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const LEVELS = { E: "error", W: "warn", N: "info", I: "info", D: "debug", V: "debug" };

/** The Emscripten ExitStatus: what `exit()` throws (a plain object with name "ExitStatus", not an Error). */
export const isExitStatus = (e) => !!e && typeof e === "object" && e.name === "ExitStatus" && typeof e.status === "number";

/**
 * Why this exists: when the last firmware thread leaves (a task deleted, a thread parked by the restart that the page is tearing down), libc calls
 * exit(); a worker cannot run it, so Emscripten proxies it to the main thread (exitOnMainThread) and the main thread throws ExitStatus. If the
 * main thread is at that moment INSIDE wasm (a mutex or futex wait in one of the page's calls: poll, button, console, an area call, a persist
 * harvest), the queued call is run from that wait and the exception unwinds into the page's own timer or promise callback: an uncaught
 * "ExitStatus" in the page (seen 1 run in 5 by web/scripts/system-check.mjs). The program is ending anyway (noExitRuntime keeps the module
 * itself alive; the host decides what runs next), so the host's calls into the module swallow exactly this object and rethrow everything else.
 * Worker threads never throw it: their exit() is the proxied call above, and their own failures reach the page as ErrorEvents (a crash, reported).
 * Only the module's exported functions that the host calls (M._name) are wrapped; Emscripten's own internals do not go through them.
 */
export function guardExports(M, onExit = null) {
  for (const k of Object.keys(M)) {
    const fn = M[k];
    if (k[0] !== "_" || k[1] === "_" || typeof fn !== "function" || fn.__guarded) continue;
    const g = function (...a) {
      try { return fn.apply(this, a); } catch (e) {
        if (!isExitStatus(e)) throw e;
        onExit?.(e.status);
        return 0;
      }
    };
    g.__guarded = true;
    M[k] = g;
  }
}

export class DotbenchDevice {
  /**
   * @param {object} [opts]
   * @param {number} [opts.pollMs=20] how often outputs/log/events are sampled while running
   * @param {boolean} [opts.autoRestart=true] reboot by itself when the firmware asks for a restart (not after a panic)
   * @param {(name: string) => Promise<ArrayBuffer|null>} [opts.resolveTarget] called when a restart names another
   *        program; return its .dotbench bytes to switch to it, or null to restart the current one
   * @param {number} [opts.maxLogLines=2000]
   */
  constructor(opts = {}) {
    this.opts = { pollMs: 20, autoRestart: true, maxLogLines: 2000, ...opts };
    this._status = { status: "idle" };
    this._listeners = new Map();
    this._pkg = null;
    this._cache = new Map();   // key -> parsed package, for load(bytes, {key}): switching programs does not recompile
    this._inst = null;
    // Persistent regions (NVS, files, SD card, device state): mirrored by the PersistManager. opts.persist is a
    // backend (persist-idb.js IdbBackend in a page, persist-node.js NodeDirBackend under Node); none = memory only.
    this._pm = new PersistManager({ backend: this.opts.persist ?? null, onEvent: (t, d) => this._emit("persist:" + t, d) });
    this._pmOpen = null;
    this._bootCount = 0;
    this._lines = [];
    this._lineId = 0;
    this._partial = new Map();
    this._frame = { seq: -1, width: SCREEN_WIDTH, height: SCREEN_HEIGHT, data: new Uint8ClampedArray(new ArrayBuffer(SCREEN_WIDTH * SCREEN_HEIGHT * 4)) };
    this._timer = null;
    this._gen = 0;
    this._rtcOffsetMs = 0;   // the device's RTC survives resets; it is the host clock plus this
    // Save when the page is going away or hidden (best effort: an async backend may not finish on pagehide).
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      this._onHide = () => { if (this._inst) this.flushPersist(); };
      window.addEventListener("pagehide", this._onHide);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") this._onHide(); });
    }
  }

  // ---------------------------------------------------------------- events
  /** @param {'status'|'log'|'outputs'|'area:*'} type @param {Function} cb @returns {() => void} */
  on(type, cb) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(cb);
    return () => this._listeners.get(type)?.delete(cb);
  }
  _emit(type, data) { for (const cb of this._listeners.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } } }
  _setStatus(status, extra = {}) { this._status = { status, ...extra }; this._emit("status", this._status); }

  /** @returns {DeviceStatus} */
  get status() { return this._status.status; }
  /** @returns {StatusDetail} */
  get statusDetail() { return this._status; }
  /** Name of the loaded program or null. */
  get appName() { return this._pkg?.appJson.display_name ?? this._pkg?.appJson.name ?? null; }
  /** Status of the last exit() the firmware's last thread asked for (swallowed, see guardExports), or undefined. */
  exitStatus;
  get appInfo() { return this._pkg ? { ...this._pkg.appJson } : null; }
  /** Worker threads of the running program (pool + running); 0 when stopped. */
  get workerCount() {
    const P = this._inst?.M.PThread;
    return P ? Object.keys(P.pthreads).length + P.unusedWorkers.length : 0;
  }
  /** wasm linear memory in bytes (0 when stopped). */
  get wasmMemoryBytes() { return this._inst ? this._inst.M.HEAPU8.byteLength : 0; }

  /** The saved device state is read once, before the first boot (start()/restart() do it too; a host that edits regions first calls this). */
  ensureOpen() { return (this._pmOpen ??= this._pm.open()); }
  /** The PersistManager (regions, host-side region access). */
  get pm() { return this._pm; }

  // ------------------------------------------------------------- lifecycle
  /**
   * Unzip a .dotbench package, build blob URLs for its module / wasm / worker, compile the wasm once.
   * Replaces any loaded program (stops it first).
   * @param {ArrayBuffer|Uint8Array} bytes
   */
  async load(bytes, opts = {}) {
    this.stop();
    this._release();
    const key = opts.key ?? null;
    if (key && this._cache.has(key)) { this._pkg = this._cache.get(key); this._setStatus("idle"); return; }
    const files = await readZip(bytes);
    const need = (n) => { const f = files.get(n); if (!f) throw new Error("package has no " + n); return f; };
    const manifest = JSON.parse(new TextDecoder().decode(need("manifest.json")));
    const appJson = JSON.parse(new TextDecoder().decode(need("appdata/app.json")));
    const jsText = new TextDecoder().decode(need(manifest.js));
    const wasmBytes = need(manifest.wasm);
    const wasmModule = await WebAssembly.compile(wasmBytes);
    // Where the scripts come from: blob: URLs in a page; files in a temp directory under Node (which cannot import blob: URLs
    // nor start a worker from one). Workers run the same script (they never spawn workers themselves: pthread_create is
    // proxied to the main thread), so the worker script is the unmodified text; the main-thread copy gets the worker URL baked in.
    const urls = [];
    let mainUrl, glueUrl;
    const re = new RegExp('new URL\\("' + manifest.js.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '",import\\.meta\\.url\\)', "g");
    if (!re.test(jsText)) throw new Error("package script does not look like a dotbench Emscripten module");
    let cleanup = () => {};
    if (IS_NODE) {
      const fs = await nodeImport("node:fs"), os = await nodeImport("node:os"), path = await nodeImport("node:path"), { pathToFileURL } = await nodeImport("node:url");
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dotbench-pkg-"));
      fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
      for (const [n, data] of files) { if (n.startsWith("factory/") || n.endsWith(".wasm")) continue; const f = path.join(dir, n); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); }
      mainUrl = pathToFileURL(path.join(dir, manifest.js)).href;
      glueUrl = (g) => pathToFileURL(path.join(dir, g)).href;
      cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
    } else {
      const blob = (parts, type) => { const u = URL.createObjectURL(new Blob(parts, { type })); urls.push(u); return u; };
      const workerUrl = blob([jsText], "text/javascript");
      mainUrl = blob([jsText.replace(re, "new URL(" + JSON.stringify(workerUrl) + ")")], "text/javascript");
      glueUrl = (g) => blob([need(g)], "text/javascript");
    }
    const glue = {};
    for (const [area, info] of Object.entries(manifest.areas ?? {})) {
      for (const g of info.glue ?? []) {
        const m = await import(/* @vite-ignore */ glueUrl(g));
        (glue[area] ??= []).push(m);
      }
    }
    const mod = await import(/* @vite-ignore */ mainUrl);
    this._pkg = { manifest, appJson, urls, cleanup, wasmModule, factory: mod.default, glue, bytes, factoryEntries: factoryEntries(files, manifest), key };
    if (key) this._cache.set(key, this._pkg);
    this._setStatus("idle");
  }

  /** Drop a package kept by `load(bytes, {key})` (its blob URLs / temp files go away). The running package is kept until replaced. */
  forget(key) {
    const p = this._cache.get(key);
    this._cache.delete(key);
    if (p && p !== this._pkg) this._free(p);
  }

  /** Boot the loaded program as a power-on: the keep store is cleared, NVS and other flash-like regions stay. */
  async start(opts = {}) {
    if (!this._pkg) throw new Error("nothing loaded");
    if (this._inst) this._teardown();
    this._pm.dropRetained();
    await this._boot(opts.reason ?? RESET.POWERON);
  }

  /** Stop: terminate every worker, free the instance. Persistent regions are kept for the next start. */
  stop() {
    if (this._inst) this._teardown();
    if (this._pkg) this._setStatus("idle");
  }

  /** Reboot like a reset: everything persistent survives, RAM does not. */
  async restart(opts = {}) {
    if (!this._pkg) throw new Error("nothing loaded");
    if (this._inst) this._teardown();
    await this._boot(opts.reason ?? RESET.EXTERNAL);
  }

  dispose() {
    this.stop();
    if (this._onHide) window.removeEventListener("pagehide", this._onHide);
    this._release();
    this._listeners.clear();
  }

  _release() {
    const p = this._pkg;
    this._pkg = null;
    if (p && !(p.key && this._cache.get(p.key) === p)) this._free(p);
  }
  _free(p) {
    // Revoked late: a worker that was terminated while its script was still being fetched must not find the URL gone.
    if (p.urls.length) setTimeout(() => p.urls.forEach((u) => URL.revokeObjectURL(u)), 10000);
    if (p.cleanup) setTimeout(() => p.cleanup(), 10000).unref?.();
  }

  async _boot(reason) {
    const gen = ++this._gen;
    this._setStatus("booting");
    const pkg = this._pkg;
    await (this._pmOpen ??= this._pm.open());           // saved device state is read once, before the first boot
    let M;
    try {
      M = await pkg.factory({
        noInitialRun: true,
        locateFile: (p) => p,
        instantiateWasm: (imports, success) => {
          WebAssembly.instantiate(pkg.wasmModule, imports).then((inst) => success(inst, pkg.wasmModule));
          return {};
        },
        print: (s) => this._pushText(2, s + "\n"),
        printErr: (s) => this._pushText(2, s + "\n"),
        onAbort: (what) => this._crash("abort: " + what),
      });
    } catch (e) {
      this._setStatus("crashed", { reason: "load failed: " + (e?.message ?? e) });
      throw e;
    }
    if (gen !== this._gen) { M.PThread.terminateAllThreads(); return; }
    guardExports(M, (status) => { this.exitStatus = status; });         // before anything (persist, glue, polling) holds on to M._xxx
    const statePtr = M._kweb_state();
    const inst = { M, statePtr, gen, pending: new Map(), glue: {}, restartSeen: 0, lastLed: -1, lastOut: "" };
    this._inst = inst;
    this._bootCount++;
    const put = (off, v) => new DataView(M.HEAPU8.buffer).setUint32(statePtr + off, v >>> 0, true);
    put(OFF.bootReason, reason);
    put(OFF.bootCount, this._bootCount);
    const enc = new TextEncoder();
    const putStr = (off, s) => { M.HEAPU8.fill(0, statePtr + off, statePtr + off + 32); M.HEAPU8.set(enc.encode(s).subarray(0, 31), statePtr + off); };
    putStr(OFF.bootName, pkg.appJson.name);
    putStr(OFF.bootVersion, pkg.appJson.version);
    const hadClock = (this._pm.image.regions.get("dev-state")?.chunks.size ?? 0) > 0;   // the RTC offset lives in dev-state
    this._pm.restoreInto(M);
    this._pm.attach(M);
    {   // first-boot content of /storage (applied only to a blank volume): the package's tree plus whatever the host adds (factoryExtra)
      const extra = this.factoryExtra?.(pkg) ?? [];
      const all = [...pkg.factoryEntries, ...extra];
      if (all.length) installFactory(M, packFactory(all));
    }
    inst.words = new Int32Array(M.HEAPU8.buffer, statePtr, 0x40);        // header .. boot block as Int32 (for Atomics)
    inst.restartSeen = Atomics.load(inst.words, OFF.restartSeq >> 2);
    for (const [area, mods] of Object.entries(pkg.glue)) {
      inst.glue[area] = mods.map((m) => m.default(this._glueContext(area, inst)));
    }
    if (!hadClock && this._rtcOffsetMs) M._kweb_time_set_offset_ms(this._rtcOffsetMs);
    M.callMain([]);
    this._setStatus("running");
    this._startPolling();
    this._watchEvents(inst);
  }

  _glueContext(area, inst) {
    const M = inst.M;
    return {
      module: M,
      statePtr: inst.statePtr,
      u32: (off) => new DataView(M.HEAPU8.buffer).getUint32(inst.statePtr + off, true),
      i32: (off) => new DataView(M.HEAPU8.buffer).getInt32(inst.statePtr + off, true),
      setU32: (off, v) => new DataView(M.HEAPU8.buffer).setUint32(inst.statePtr + off, v >>> 0, true),
      // a torn-down instance: its workers are gone and may have died holding a lock; a page export that finds a lock taken answers "busy"
      // and the caller retries (writes) or asks again at its next poll (reads): page-call.js, runtime/drivers/include/page_lock.h
      call: (fn, ...args) => this._caller(inst).call(fn, ...args),
      get busy() { return inst.caller?.busy ?? false; },
      alloc: (n) => this._caller(inst).alloc(n),
      free: (p) => this._caller(inst).free(p),
      heap: () => M.HEAPU8,
      emit: (type, data) => this._emit("area:" + area + ":" + type, data),
      onTick: (cb) => { (inst.ticks ??= []).push(cb); },
    };
  }

  _caller(inst) { return (inst.caller ??= makeCaller(inst.M, { dead: () => inst.dead })); }
  /** {busy, retried, dropped, pending}: page calls that met a lock a firmware thread held (0 = the page never had to wait). */
  get pageCalls() { const c = this._inst?.caller; return c ? { ...c.stats, pending: c.pending() } : { busy: 0, retried: 0, dropped: 0, pending: 0 }; }

  _teardown() {
    const inst = this._inst;
    if (!inst) return;
    this._inst = null;
    this._stopPolling();
    this._drainText(inst);
    this._flushPartial();
    const M = inst.M;
    inst.dead = true;
    inst.caller?.dispose();                              // from here on glue calls into the module are refused (see _glueContext)
    for (const mods of Object.values(inst.glue ?? {})) for (const h of mods) { try { h?.dispose?.(); } catch { /* best effort */ } }
    this._rtcOffsetMs = M._kweb_time_offset_ms();
    M.PThread.terminateAllThreads();
    try { Atomics.notify(M.HEAP32, M._pthread_self() >> 2); } catch { /* mailbox wait already gone */ }
    inst.dead = true;
    this._pm.finalize();                                // full compare of every region, then commit (async)
  }

  _snapshot(inst) { this._pm.scanAll(); return this._pm.exportMap(); }

  /** Persistent regions (name -> bytes) as of the last stop/restart, for the page to mirror to IndexedDB. */
  exportPersist() { return this._inst ? this._snapshot(this._inst) : this._pm.exportMap(); }
  /** Seed persistent regions (Map<name, Uint8Array>) before start(). */
  importPersist(map) { this._pm.importMap(map); }
  /** Forget NVS, files, SD and the clock, as a factory reset would (also erases the durable copy). */
  factoryReset() { return this._pm.erase(); }

  // ------------------------------------------------------------- persistence (runtime/persist, docs/STATUS-persistence.md)
  /** {backend, loaded, flushes, bytes, lastError, incompatible}: bytes = what is held in the mirror image. */
  get persist() {
    const pm = this._pm;
    return { backend: !!pm.backend, loaded: pm.loaded, flushes: pm.flushes, bytes: pm.image.bytesStored(), lastError: pm.lastError, incompatible: pm.incompatible };
  }
  /** Flush now (dirty chunks of the running device) and wait for the backend. Call on pagehide/visibilitychange; start() does not need it. */
  flushPersist() { this._pm.harvest(); return this._pm.flush(); }
  /** Erase device: stop, forget every persistent region (NVS, files, SD, clock) in the mirror AND in the durable store. */
  async eraseDevice() {
    if (this._inst) this._teardown();
    this._rtcOffsetMs = 0;
    await this._pm.erase();
    this._pmOpen = Promise.resolve();
    if (this._pkg) this._setStatus("idle");
    this._emit("persist:erased", {});
  }
  /** The whole device as one file (Uint8Array): every persistent region plus a header. Works while running. */
  exportDeviceFile(extra = {}) {
    if (this._inst) this._pm.scanAll();
    return this._pm.exportDeviceFile(extra);
  }
  /** Replace the whole device with a file from exportDeviceFile(). The device must be stopped. Resolves when stored. */
  async importDeviceFile(bytes) {
    if (this._inst) throw new Error("stop the device before importing a device file");
    await (this._pmOpen ??= this._pm.open());
    this._pm.importDeviceFile(bytes);
    return this._pm.commitAll();
  }

  _crash(reason) {
    if (!this._inst) return;
    this._teardown();
    this._setStatus("crashed", { reason });
  }

  // --------------------------------------------------------------- polling
  _startPolling() { this._stopPolling(); this._timer = setInterval(() => this.poll(), this.opts.pollMs); }
  _stopPolling() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  // Hidden tabs throttle setInterval to 1 Hz or worse. A MessageChannel ping-pong re-armed by setTimeout is
  // throttled the same way, so a second path is used while hidden: Atomics.waitAsync on the restart counter
  // (the firmware bumps it and the host is woken by the Atomics.notify in kweb_restart's path), and
  // visibilitychange polls at once. Both are best effort; poll() is idempotent.
  _watchEvents(inst) {
    if (typeof Atomics.waitAsync !== "function") return;
    const idx = OFF.restartSeq >> 2;
    const arm = () => {
      if (inst.dead) return;
      const r = Atomics.waitAsync(inst.words, idx, inst.restartSeen, 1000);
      Promise.resolve(r.async ? r.value : "not-equal").then(() => { if (!inst.dead) { this.poll(); arm(); } }).catch((e) => { if (!isExitStatus(e)) throw e; });
    };
    arm();
  }

  /** Sample the shared state: outputs, log ring, restart/panic events. Cheap; called by the internal timer. */
  poll() {
    const inst = this._inst;
    if (!inst || inst.dead) return;
    this._drainText(inst);
    for (const cb of inst.ticks ?? []) cb();
    this._pm.tick();
    const w = inst.words;
    const seq = Atomics.load(w, OFF.restartSeq >> 2);
    if (seq !== inst.restartSeen) {
      inst.restartSeen = seq;
      this._onRestartRequest(inst);
      return;
    }
    const out = this._outputsKey(inst);
    if (out !== inst.lastOut) { inst.lastOut = out; this._emit("outputs", this.outputs()); }
  }

  _outputsKey(inst) {
    const dv = new DataView(inst.M.HEAPU8.buffer);
    const g = (o) => dv.getUint32(inst.statePtr + o, true);
    return [g(OFF.ledRgb), g(OFF.panelOn), g(OFF.backlight), g(OFF.haptic)].join(",");
  }

  _onRestartRequest(inst) {
    const dv = new DataView(inst.M.HEAPU8.buffer);
    const code = dv.getUint32(inst.statePtr + OFF.restartReason, true);
    const target = cstr(inst.M.HEAPU8, inst.statePtr + OFF.restartTarget, 32);
    const reason = RESET_NAME[code] ?? String(code);
    this._drainText(inst);
    this._flushPartial();
    this._setStatus("restart-requested", { reason, target });
    if (code === RESET.PANIC) { this._teardown(); this._setStatus("crashed", { reason: "panic" }); return; }
    if (!this.opts.autoRestart) return;
    queueMicrotask(async () => {
      try {
        if (target && this.opts.resolveTarget) {
          const bytes = await this.opts.resolveTarget(target);
          if (bytes) { this._teardown(); await this.load(bytes); await this._boot(code); return; }
        }
        this._teardown();
        await this._boot(code);
      } catch (e) { this._setStatus("crashed", { reason: String(e?.message ?? e) }); }
    });
  }

  // ----------------------------------------------------------------- screen
  /**
   * Copy the current frame (RGBA, 410x502) into `out` if the picture changed since `lastSeq`.
   * @param {Uint8ClampedArray} out plain-ArrayBuffer-backed, length >= 410*502*4
   * @param {number} [lastSeq=-1] sequence number of the frame `out` already holds
   * @returns {number} the frame sequence number (equal to lastSeq: nothing was copied)
   */
  copyFrame(out, lastSeq = -1) {
    const inst = this._inst;
    if (!inst) return lastSeq;
    const dv = new DataView(inst.M.HEAPU8.buffer);
    const seq = dv.getUint32(inst.statePtr + OFF.frameSeq, true);
    if (seq === lastSeq) return seq;
    const off = inst.statePtr + dv.getUint32(inst.statePtr + OFF.fbOffset, true);
    out.set(new Uint8ClampedArray(inst.M.HEAPU8.buffer, off, SCREEN_WIDTH * SCREEN_HEIGHT * 4));
    return seq;
  }
  /** Frame object that is reused (same `data`, same object) while the picture is unchanged. */
  frame() {
    const f = this._frame;
    const seq = this.copyFrame(f.data, f.seq);
    if (seq !== f.seq) this._frame = { ...f, seq };
    return this._frame;
  }
  get frameSeq() { return this._u32(OFF.frameSeq); }
  get backlight() { return this._u32(OFF.backlight); }
  get panelOn() { return this._u32(OFF.panelOn) !== 0; }
  _u32(off) {
    const inst = this._inst;
    return inst ? new DataView(inst.M.HEAPU8.buffer).getUint32(inst.statePtr + off, true) : 0;
  }

  // ----------------------------------------------------------------- inputs
  /** @param {number|string} id 0..5 or 'up'|'down'|'left'|'right'|'top'|'bottom' */
  button(id, pressed) {
    const n = typeof id === "number" ? id : BUTTONS[id];
    if (n === undefined || !this._inst) return;
    this._inst.M._kweb_button(n, pressed ? 1 : 0);        // lock-free hand-over to the firmware's input thread
  }
  touch(x, y, down) { this._inst?.M._kweb_touch(Math.round(x), Math.round(y), down ? 1 : 0); }
  /** Release every button and the touch (the page calls this on blur). */
  releaseAll() {
    if (!this._inst) return;
    for (let i = 0; i < 6; i++) this._inst.M._kweb_button(i, 0);
    if (this._u32(0x7c)) this._inst.M._kweb_touch(0, 0, 0);
  }

  // ---------------------------------------------------------------- outputs
  get led() { const v = this._u32(OFF.ledRgb); return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }; }
  /** Vibration strength 0..1 (the chip's 0..255 divided by 255). */
  get haptic() { return this._u32(OFF.haptic) / 255; }
  outputs() { return { led: this.led, haptic: this.haptic, backlight: this.backlight, panelOn: this.panelOn }; }

  // ------------------------------------------------------------- console/log
  /** Lines so far (bounded), oldest first. */
  get lines() { return this._lines; }
  clearLog() { this._lines = []; }
  /** Type a line into the console: echoed into the log with level 'input', then delivered to the firmware. */
  sendConsole(line) {
    this._addLine(1, "input", line);
    // the firmware's terminal echoes what it receives ("kode> help"): drop that one line, the page already showed it
    this._echo = { text: line.trim(), until: Date.now() + 3000 };
    const inst = this._inst;
    if (!inst) return;
    const bytes = new TextEncoder().encode(line + "\n");
    const p = inst.M._malloc(bytes.length);
    inst.M.HEAPU8.set(bytes, p);
    inst.M._kweb_console_input(p, bytes.length);
    inst.M._free(p);
  }

  _drainText(inst) {
    const M = inst.M;
    const cap = 16384;
    if (!inst.drainBuf) inst.drainBuf = M._malloc(cap);
    for (;;) {
      const n = M._kweb_text_drain(inst.drainBuf, cap);
      if (!n) break;
      const bytes = M.HEAPU8.slice(inst.drainBuf, inst.drainBuf + n);
      for (let i = 0; i + 3 <= bytes.length;) {
        const ch = bytes[i], len = bytes[i + 1] | (bytes[i + 2] << 8);
        this._pushText(ch, new TextDecoder().decode(bytes.subarray(i + 3, i + 3 + len)));
        i += 3 + len;
      }
    }
  }
  _pushText(channel, text) {
    let buf = (this._partial.get(channel) ?? "") + text;
    const parts = buf.split(/\r?\n/);
    buf = parts.pop();
    for (const l of parts) this._addLine(channel, null, l);
    this._partial.set(channel, buf);
    // a prompt ("kode> ") has no newline: show it once the output has been quiet for a moment
    clearTimeout(this._partialTimer);
    this._partialTimer = setTimeout(() => this._flushPartial(), 150);
  }
  _flushPartial() {
    for (const [ch, buf] of this._partial) if (buf.trim()) this._addLine(ch, null, buf);
    this._partial.clear();
  }
  _addLine(channel, forcedLevel, raw) {
    let text = raw.replace(ANSI, "").replace(/\r/g, "");
    if (!text.trim()) return;
    if (!forcedLevel && channel === 1 && this._echo && Date.now() < this._echo.until
        && text.replace(/^\s*kode>\s*/, "").trim() === this._echo.text) { this._echo = null; return; }
    let level = forcedLevel ?? "info";
    if (!forcedLevel) {
      const m = /^!([EWNIDV]) /.exec(text);
      if (m) { level = LEVELS[m[1]]; text = text.slice(3); }
    }
    const line = { id: this._lineId++, ts: Date.now(), level, text, channel };
    this._lines.push(line);
    if (this._lines.length > this.opts.maxLogLines) this._lines.splice(0, this._lines.length - this.opts.maxLogLines);
    this._emit("log", line);
  }

  // ------------------------------------------------------------------- time
  /** Device clock, epoch ms: the host clock plus whatever the firmware set with settimeofday. */
  time() {
    const inst = this._inst;
    if (!inst) return Date.now() + this._rtcOffsetMs;
    return Date.now() + inst.M._kweb_time_offset_ms();
  }

  // ------------------------------------------------------------------ areas
  /** The JS glue object an area registered (null when the package has none or nothing runs). Recreated at every boot. */
  area(name) { return this._inst?.glue[name]?.[0] ?? null; }
  /** Names of the areas that ship JS glue. */
  get areaNames() { return Object.keys(this._pkg?.glue ?? {}); }
}
