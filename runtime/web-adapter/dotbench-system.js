// DotbenchSystem: the simulated Kode Dot as a whole. One object for the page: kodeOS plus the apps installed in it.
//
// It sits above DotbenchDevice (one wasm program at a time) and owns what the real board has around the firmware:
//   * the persistent regions (through the device's PersistManager), among them the apps region and the mailbox;
//   * the registry of program bundles (the .dotbench of each installed app; bundles.js), persisted with them;
//   * the BOOTLOADER: when the running program asks for a restart, the page tears it down and decides what boots next exactly as
//     KodeOS's bootloader_start.c does (kapps.js tryBootRequestedApp: the 20-byte "KRUN" request, NEW/ALWAYS/ARMED/TRIED, the keep
//     list of reset causes), then starts kodeOS or the requested app's bundle on the same persisted regions.
// The page never sees a restart: events are the device's (status, log, outputs, area:*) for whichever program runs, plus `program`.
//
//   const sys = new DotbenchSystem({ os: bytesOfKodeosDotbench, persist: new IdbBackend(), factory: { apps: [...], fetch } });
//   await sys.start();                       // power-on: first boot seeds the factory apps, kodeOS shows them
//   sys.on("program", ({id, name, kind}) => ...);   // kind "os" | "app"
//   await sys.install(bytes); sys.list(); await sys.remove(id); await sys.launch(id); await sys.home(); await sys.factoryReset();
//   sys.on("update", (r) => ...);            // at start: what the site's newer factory set changed ({installed, updated, removed, kept, failed, os})
//   sys.on("factory-reset", ({by}) => ...);  // by "os": kodeOS's own Settings -> About -> Factory reset finished and the factory apps are back
//
// UPDATES (docs/STATUS-boot.md "Updates and factory resets"): the store records which factory packages it installed ({package: {project, hash,
// removed?}}, bundles.js). Every start compares the site's list with it: a package new in the list is installed, one whose bytes changed
// replaces the installed one in place (its data folders stay), one the user removed stays removed until a factory reset, and an app the user
// installed under their own build is never touched. kodeOS itself is never stored: it always runs the bytes the page handed in.
import { DotbenchDevice, RESET, BUTTONS } from "./dotbench-device.js";
import { readZip } from "./zip.js";
import { AppsFlash, AppsRegion, PENDING_REGION, PENDING_SIZE, K, ROM, hex, synthImage, tryBootRequestedApp } from "./kapps.js";
import { BundleStore } from "./bundles.js";

const OS_ID = "os";
const OWN_EVENTS = new Set(["status", "program", "apps", "update", "factory-reset"]);
/** The line AO_Boot logs when kodeOS's own factory reset has erased everything and is about to restart (boot_ao.c reset_finish). */
const OS_RESET_DONE = /factory reset: restarting into/;
const APPDATA_ROOT = "/storage/.kode/appsdata/";
const dec = new TextDecoder();

/** ROM reset cause (what the bootloader reads) for a reset the firmware asked for (RESET.* of the bridge). */
const CAUSE = { [RESET.POWERON]: ROM.POWERON, [RESET.SOFTWARE]: ROM.CPU_SW, [RESET.PANIC]: ROM.CPU_SW, [RESET.DEEPSLEEP]: ROM.DEEP_SLEEP, [RESET.EXTERNAL]: ROM.WDT };

async function sha256(bytes) { return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)); }

/** What the system needs from a .dotbench: its manifest, the app's identity and the board's data folder (app.json + icon.k64). */
export async function readPackageInfo(bytes) {
  const files = await readZip(bytes);
  const manifest = JSON.parse(dec.decode(files.get("manifest.json") ?? new Uint8Array()) || "null");
  if (!manifest) throw new Error("not a .dotbench package (no manifest.json)");
  const appJson = JSON.parse(dec.decode(files.get("appdata/app.json") ?? new Uint8Array()) || "null");
  if (!appJson?.name) throw new Error("package has no appdata/app.json");
  const board = { json: files.get("board/app.json") ?? null, icon: files.get("board/icon.k64") ?? null };
  return { manifest, appJson, board };
}

export class DotbenchSystem {
  /**
   * @param {object} o
   * @param {ArrayBuffer|Uint8Array} o.os            kodeos.dotbench
   * @param {object} [o.persist]                     a persistence backend (IdbBackend in a page, NodeDirBackend under Node); none = memory only
   * @param {{apps: (string|{package: string})[], fetch: (name: string) => Promise<ArrayBuffer|Uint8Array>}|null} [o.factory]
   *        the factory.json content and a way to get a named package: installed once, on the first boot of an empty device
   * @param {number} [o.pollMs]
   */
  constructor(o) {
    if (!o?.os) throw new Error("DotbenchSystem needs the kodeOS package (o.os)");
    this.osBytes = o.os instanceof Uint8Array ? o.os : new Uint8Array(o.os);
    this.factory = o.factory ?? null;
    this.device = new DotbenchDevice({ persist: o.persist, autoRestart: false, pollMs: o.pollMs });
    this.pm = this.device._pm;
    this._own = new Map();
    this._program = null;
    this._status = { status: "idle" };
    this._switching = false;
    this._chain = Promise.resolve();
    this._held = new Set();
    this._infoCache = new Map();
    this._stale = new Set();
    this._started = false;
    this.device.on("status", (s) => this._onDeviceStatus(s));
    // kodeOS's own factory reset ends in a plain software restart; this line (logged before the restart request is read) tells the
    // bootloader we play that the board was wiped, so the factory image's apps must be put back (the real board's come from the factory image)
    this.device.on("log", (l) => { if (this._program?.kind === "os" && OS_RESET_DONE.test(l.text)) this._osReset = true; });
  }

  // ------------------------------------------------------------------ events
  /** "status" (idle|booting|running|crashed, as the device's but without restarts), "program" ({id, name, kind}), "apps" (the list changed),
   *  and everything the device emits: "log", "outputs", "area:<name>:<type>", "persist:*". Returns an unsubscribe. */
  on(type, cb) {
    if (!OWN_EVENTS.has(type)) return this.device.on(type, cb);
    if (!this._own.has(type)) this._own.set(type, new Set());
    this._own.get(type).add(cb);
    return () => this._own.get(type)?.delete(cb);
  }
  _emit(type, data) { for (const cb of this._own.get(type) ?? []) { try { cb(data); } catch (e) { console.error(e); } } }
  _setStatus(status, extra = {}) { this._status = { status, ...extra }; this._emit("status", this._status); }
  get status() { return this._status.status; }
  get statusDetail() { return this._status; }
  /** {id, name, kind} of the running program, or null. */
  get program() { return this._program; }

  // --------------------------------------------------------------- serialisation
  _run(fn) { const p = this._chain.then(fn); this._chain = p.catch(() => { this._quiet = false; }); return p; }

  // --------------------------------------------------------------- lifecycle
  /** Power-on. The first boot of an empty device installs the factory set before kodeOS starts. */
  start() { return this._run(() => this._powerOn()); }
  async _powerOn() {
    await this.device.ensureOpen();
    this._started = true;
    if (this.device.status !== "idle" || this.device._inst) this.device.stop();
    await this._syncFactory();
    await this._boot(RESET.POWERON, true);
  }
  /** Stop everything (the device is left as it is on disk). */
  stop() { this._started = false; this.device.stop(); this._program = null; this._setStatus("idle"); }
  dispose() { this.device.dispose(); }

  /** Power-on reset (the BOT+LEFT chord). Retires a standing sticky request; a NEW one has been consumed already. */
  powerOnReset() { return this._run(async () => { this.releaseAll(); this._quiesce(); await this._boot(RESET.POWERON, true); }); }
  /** Exit to the OS, as an app's own "hold BOT 3 s" or kode_sys_exit_to_os() does: a software restart, kodeOS reads FROM_APP. */
  home() {
    return this._run(async () => {
      if (this._program?.kind !== "app") return;
      this._quiesce();
      await this._boot(RESET.SOFTWARE, false);
    });
  }
  /** Same effect as tapping the app in kodeOS: the boot request kdrv_apps_req_set writes (NEW, or ALWAYS with {sticky:true}), then a restart. */
  launch(id, { sticky = false } = {}) {
    return this._run(async () => {
      const app = this.list().find((a) => a.id === id);
      if (!app) throw new Error("no such app: " + id);
      this._quiesce();
      const region = this._region();
      region.writeReq(app.offset, app.size, sticky ? K.STATE.ALWAYS : K.STATE.NEW);
      await this._boot(RESET.SOFTWARE, false);
    });
  }
  /** Erase the whole device (settings, files, apps, bundles): the next start is a first boot. */
  factoryReset() {
    return this._run(async () => {
      this.device.stop(); this._program = null;
      await this.device.eraseDevice();
      this._infoCache.clear(); this._stale.clear();
      this._osReset = false;
      if (this._started) { await this._syncFactory(); await this._boot(RESET.POWERON, true); } else this._setStatus("idle");
      this._emit("apps", this.list());
    });
  }

  // ------------------------------------------------------------------ bootloader
  _flash() { return new AppsFlash(this.pm); }
  _region() { const r = new AppsRegion(this._flash()); r.load(); return r; }
  _bundles() { return new BundleStore(this.pm); }
  _mailboxFull() {
    const h = new AppsFlash(this.pm, PENDING_REGION, PENDING_SIZE).read(0, 4);
    return h[0] === K.IMAGE_MAGIC || new DataView(h.buffer).getUint32(0, true) === K.KFW_MAGIC;
  }

  /** The program is torn down; its regions are final in the host image. */
  _quiesce() { this._quiet = true; if (this.device._inst) this.device.stop(); }

  /** Decide what boots after a reset of kind `code` (the bootloader), then start it. `power`: power-on (the keep store is cleared). */
  async _boot(code, power) {
    this._switching = true;
    this._setStatus("booting");
    try {
      if (this._osReset) await this._afterOsReset();
      const region = this._region();
      this._gc();                                   // bundles whose app the OS deleted
      const hit = tryBootRequestedApp(region, CAUSE[code] ?? ROM.WDT, this._mailboxFull());
      await this.pm.flush();
      let target = { id: OS_ID, name: "kodeOS", kind: "os", bytes: this.osBytes };
      if (hit) {
        const bytes = this._bundles().get(hit.buildId);
        if (bytes) target = { id: hit.buildId, name: hit.name || hit.project, kind: "app", bytes };
      }
      await this.device.load(target.bytes, { key: target.kind === "os" ? "os:" + (this._osHash ?? "") : target.id });
      if (power) await this.device.start({ reason: code }); else await this.device.restart({ reason: code });
      this._program = { id: target.id, name: target.name, kind: target.kind };
      this._emit("program", this._program);
      this._switching = false; this._quiet = false;
      this._setStatus("running");
      if (this._program.kind === "os") this._appdataSoon();
    } catch (e) {
      this._switching = false;
      this._setStatus("crashed", { reason: String(e?.message ?? e) });
      throw e;
    }
  }

  _onDeviceStatus(s) {
    if (this._switching || (this._quiet && s.status === "idle")) return;
    if (s.status === "restart-requested") {
      const code = RESET[String(s.reason ?? "").toUpperCase()] ?? RESET.SOFTWARE;
      if (code === RESET.PANIC) return;                      // the device tears itself down and reports "crashed" next
      this._run(async () => { this._quiesce(); await this._boot(code, code === RESET.POWERON); }).catch(() => {});
      return;
    }
    if (s.status === "crashed" && this._program?.kind === "app") {
      // a crash in an app: the board resets, and (unless a sticky request keeps it) kodeOS comes up
      this._emit("status", { status: "booting", reason: "app crashed: " + (s.reason ?? "") });
      this._run(async () => { this._quiesce(); await this._boot(RESET.PANIC, false); }).catch(() => {});
      return;
    }
    if (s.status === "idle" && this._started === false) return;
    this._status = s; this._emit("status", s);
  }

  // ---------------------------------------------------------------- apps
  /** The installed apps, in install order: [{id (bundle id), project, name, version, category, size, offset, seq, hasBundle}]. Works while running. */
  list() {
    const region = this._region(), store = this._bundles();
    return region.list().map((a) => ({ id: a.buildId, project: a.project, name: a.name || a.project, version: a.version, category: a.category, size: a.size, offset: a.offset, seq: a.seq, hasBundle: store.has(a.buildId) }));
  }

  /** Install a user's .dotbench: its bundle is stored, an image is placed in the apps region through the same directory update the AppMgr
   *  does, its data folder goes to /storage/.kode/appsdata/<project>. When kodeOS runs it restarts to re-read the directory. */
  install(bytes) { return this._run(() => this._install(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))); }
  async _install(bytes, { seeding = false, hash = null } = {}) {
    const info = await readPackageInfo(bytes);
    const id = hash ?? hex(await sha256(bytes));
    const wasOs = !seeding && this._program?.kind === "os";
    if (wasOs) { this._quiesce(); }
    const store = this._bundles();
    const region = this._region();
    const a = info.appJson;
    const image = synthImage({ project: a.name, version: a.version ?? "0.0.0", name: a.display_name ?? a.name, category: a.category ?? "", buildId: Uint8Array.from(id.match(/../g), (h) => parseInt(h, 16)) });
    const old = region.findProject(a.name);
    store.put(id, bytes, { project: a.name, name: a.display_name ?? a.name, version: a.version ?? "" });
    const { evicted } = region.install(image);
    for (const e of evicted) this._stale.add(e);
    if (old && old.buildId !== id) this._stale.delete(a.name);
    this._infoCache.set(id, info);
    this._gc();
    await this.pm.flush();
    this._emit("apps", this.list());
    if (!seeding) {
      if (wasOs) await this._boot(RESET.SOFTWARE, false); else this._appdataSoon();
    }
    return { id, project: a.name, evicted };
  }

  /** Delete an app (like the OS's own delete: directory entry, image header, data folder, bundle). */
  remove(id) {
    return this._run(async () => {
      const app = this.list().find((x) => x.id === id);
      if (!app) return false;
      const wasOs = this._program?.kind === "os";
      if (this._program?.kind === "app" && this._program.id === id) { this._quiesce(); }
      else if (wasOs) this._quiesce();
      const region = this._region();
      region.remove(app.project);
      this._stale.add(app.project);
      this._gc();
      await this.pm.flush();
      this._emit("apps", this.list());
      if (wasOs || !this.device._inst) await this._boot(RESET.SOFTWARE, false);
      else this._appdataSoon();
      return true;
    });
  }

  /** Drop bundles no directory entry names any more (the OS's own delete leaves them behind). */
  _gc() {
    const store = this._bundles(), live = new Set(this._region().list().map((a) => a.buildId));
    for (const id of store.ids()) if (!live.has(id)) { store.delete(id); this.device.forget(id); this._infoCache.delete(id); }
  }

  // ---------------------------------------------------------------- the factory set: first boot, updates, OS-initiated reset
  _factoryEntries() {
    return (this.factory?.apps ?? []).map((x) => (typeof x === "string" ? { pkg: x } : { pkg: x.package, hash: x.sha256 ?? x.hash ?? null }));
  }

  /**
   * Bring the installed factory apps in line with the site's list (every start, and after a factory reset). Runs while no program runs.
   * Per listed package P (record = what the store remembers about P):
   *   no record, not installed             new: installed (first boot, a package the site added later, or a store from before records)
   *   no record, installed, store has none (first boot of an imported device / a store from before records): adopted; replaced if its bytes differ
   *   no record, installed, store has records: a user's own app of that name: left alone
   *   record, not installed                the user removed it: marked removed, stays removed until a factory reset
   *   record, installed with another build the user's own build of that app: left alone
   *   record, installed, hash differs      the bundled package changed: replaced in place, data folders kept
   * Returns {installed, updated, removed, kept, failed, os}; also emitted as "update" when anything changed.
   */
  async _syncFactory() {
    const store = this._bundles();
    const entries = this._factoryEntries();
    const report = { installed: [], updated: [], removed: [], kept: [], failed: [], os: null };
    const wasSeeded = store.seeded, had = store.factoryRecords();
    const recs = had ?? {};
    const adopt = !had;                       // first boot or a store made before records: an installed namesake is the old factory build
    const osHash = hex(await sha256(this.osBytes));
    this._osHash = osHash.slice(0, 16);
    for (const e of entries) {
      try {
        let rec = recs[e.pkg];
        let bytes = null, hash = e.hash ?? null, info = null;
        const installedBy = (project) => this._region().findProject(project);
        if (rec && hash && rec.hash === hash) {                   // nothing changed in the list entry: no need to download it
          const inst = installedBy(rec.project);
          if (!inst) { if (!rec.removed) { rec.removed = true; report.removed.push(rec.project); } }
          else if (rec.removed) delete rec.removed;
          continue;
        }
        bytes = await this.factory.fetch(e.pkg);
        bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
        hash = hex(await sha256(bytes));
        info = await readPackageInfo(bytes);
        const project = info.appJson.name;
        if (rec && rec.project !== project) rec = undefined;      // the package became another app: treated as new
        const inst = installedBy(project);
        if (rec) {
          if (!inst) { if (!rec.removed) { rec.removed = true; report.removed.push(project); } continue; }
          delete rec.removed;
          if (inst.buildId !== rec.hash) { report.kept.push(project); continue; }   // the user installed their own build over it
          if (hash === rec.hash) continue;
          await this._install(bytes, { seeding: true, hash });
          rec.hash = hash; report.updated.push(project);
        } else if (!inst) {
          await this._install(bytes, { seeding: true, hash });
          recs[e.pkg] = { project, hash }; report.installed.push(project);
        } else if (adopt) {
          if (inst.buildId !== hash) { await this._install(bytes, { seeding: true, hash }); report.updated.push(project); }
          recs[e.pkg] = { project, hash };
        } else report.kept.push(project);
      } catch (err) {
        report.failed.push({ package: e.pkg, error: String(err?.message ?? err) });
        console.warn("dotbench: factory package " + e.pkg + ": " + (err?.message ?? err));
      }
    }
    store.setFactory(recs, true);
    const prevOs = store.osHash;
    if (prevOs !== osHash) { store.osHash = osHash; if (prevOs) report.os = { from: prevOs.slice(0, 16), to: this._osHash }; }
    void wasSeeded;
    await this.pm.flush();
    this.lastUpdate = report;
    this._emit("apps", this.list());
    if (report.installed.length || report.updated.length || report.removed.length || report.failed.length || report.os) this._emit("update", report);
    return report;
  }

  /** kodeOS's own factory reset has erased settings, apps and their files and restarted: the factory image (the site's list) is put back,
   *  exactly what factoryReset() ends with. What the OS keeps on purpose (its identity cache, the SD card's other files) stays. */
  async _afterOsReset() {
    this._osReset = false;
    this._bundles().setFactory(null, false);           // a first boot again: nothing remembered, nothing removed on purpose
    this._infoCache.clear(); this._stale.clear();
    this._gc();                                        // the user's bundles went with the OS's wipe of the directory
    await this._syncFactory();
    this._emit("factory-reset", { by: "os" });
  }

  // ------------------------------------------------- the data folders on /storage
  _appdataSoon() {
    if (this._appdataBusy) return;
    this._appdataBusy = (async () => {
      try {
        for (let i = 0; i < 100; i++) {
          const fsApi = this.device.area("storage");
          if (!this.device._inst || !fsApi) return;
          if (fsApi.mounted("storage")) { await this._syncAppdata(fsApi); return; }
          await new Promise((r) => setTimeout(r, 100));
        }
      } catch (e) { console.error("appdata:", e); } finally { this._appdataBusy = null; }
    })();
  }
  async _info(id) {
    if (!this._infoCache.has(id)) { const b = this._bundles().get(id); if (b) this._infoCache.set(id, await readPackageInfo(b)); }
    return this._infoCache.get(id) ?? null;
  }
  /** Make /storage/.kode/appsdata/<project>/{app.json,icon.k64} match the installed apps (what the board's AppMgr/kgui read for name and icon). */
  async _syncAppdata(fsApi) {
    const enc = new TextEncoder();
    const same = (path, want) => { const st = fsApi.stat(path); if (!st.exists || st.size !== want.length) return false; const got = fsApi.read(path); return got.every((b, i) => b === want[i]); };
    for (const a of this.list()) {
      const dir = APPDATA_ROOT + a.project;
      const info = await this._info(a.id);
      if (!info) continue;
      // the board's own files for the app (name, icon): written when missing, and rewritten when an update of the package changed them.
      // Nothing else in the folder is touched: that is the app's saved data.
      const json = info.board.json ?? enc.encode(JSON.stringify({ kode: "1" }));
      if (same(dir + "/app.json", json) && (!info.board.icon || same(dir + "/icon.k64", info.board.icon))) continue;
      fsApi.mkdir(dir, { parents: true });
      fsApi.write(dir + "/app.json", json);
      if (info.board.icon) fsApi.write(dir + "/icon.k64", info.board.icon);
    }
    for (const p of [...this._stale]) {
      this._stale.delete(p);
      if (this.list().some((a) => a.project === p)) continue;
      const dir = APPDATA_ROOT + p;
      try { for (const f of fsApi.list(dir)) fsApi.remove(dir + "/" + f.name); fsApi.remove(dir); } catch { /* not there */ }
    }
    this._emit("apps", this.list());
  }
  /** Resolves when the data folders have been written after the last boot/install (tests, page). */
  async settled() { await this._appdataBusy; }

  // ------------------------------------------------- the device, for whichever program runs
  get appName() { return this._program?.name ?? null; }
  get appInfo() { return this.device.appInfo; }
  get workerCount() { return this.device.workerCount; }
  get wasmMemoryBytes() { return this.device.wasmMemoryBytes; }
  copyFrame(out, lastSeq = -1) { return this.device.copyFrame(out, lastSeq); }
  frame() { return this.device.frame(); }
  get frameSeq() { return this.device.frameSeq; }
  get backlight() { return this.device.backlight; }
  get panelOn() { return this.device.panelOn; }
  get led() { return this.device.led; }
  get haptic() { return this.device.haptic; }
  outputs() { return this.device.outputs(); }
  get lines() { return this.device.lines; }
  clearLog() { this.device.clearLog(); }
  sendConsole(line) { this.device.sendConsole(line); }
  time() { return this.device.time(); }
  area(name) { return this.device.area(name); }
  get areaNames() { return this.device.areaNames; }
  get persist() { return this.device.persist; }
  flushPersist() { return this.device.flushPersist(); }
  exportDeviceFile(extra) { return this.device.exportDeviceFile(extra); }

  /** Buttons 0..5 or names; the BOT+LEFT chord is a power-on reset of the whole board, whichever program runs. */
  button(id, pressed) {
    const n = typeof id === "number" ? id : BUTTONS[id];
    if (n === undefined) return;
    if (pressed) this._held.add(n); else this._held.delete(n);
    this.device.button(n, pressed);
    if (pressed && this._held.has(BUTTONS.bottom) && this._held.has(BUTTONS.left) && this._program && !this._switching) { this.powerOnReset().catch(() => {}); }
  }
  touch(x, y, down) { this.device.touch(x, y, down); }
  releaseAll() { this._held.clear(); this.device.releaseAll(); }
}
export { RESET, BUTTONS };
