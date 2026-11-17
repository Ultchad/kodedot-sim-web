// UsbComputer: "a computer on a USB cable" for a DotbenchSystem (the simulated Kode Dot).
//
// It is the COMPUTER side of the USB-C link. It speaks the console protocol the real tool (KodeOS tools/kcli.py) speaks:
// one command per line, `>|` records, `>ok` / `>err` terminators, `!` lines are logs; `install` / `file_put` switch the wire to
// raw bytes after `>|ready chunk=N` and send one chunk per `>|ack` (stop-and-wait: the wire has no flow control). The Dot side
// is the real firmware (kodeOS: AO_Log, console AO, AppMgr, the real kdrv_kfw decoder) behind runtime/drivers/usb/usb.js.
//
// What this file adds to the system layer (the whole "mailbox path" addition, nothing else in the adapter changed): before an image is
// sent, the .dotbench it stands for is registered in the bundle store under its bundle id (the SHA-256 the KAPD descriptor carries),
// so when the real AppMgr has adopted the image into the apps region the page's bootloader finds the wasm bundle to boot.
//
//   const pc = new UsbComputer(sys);               // sys: DotbenchSystem
//   pc.plug();                                      // cable in, computer's serial port open (re-plugged after every restart)
//   await pc.ping();                                // `ping` -> ">ok"
//   await pc.installPackage(dotbenchBytes, {run:false});                  // kcli install + appdata put (direct)
//   await pc.installPackage(bytes, {via:"mailbox", run:true});            // install dst=pending, then src="pending" dst=app
//   await pc.installPackage(bytes, {container:true});                     // a KFW1 container carrying app.json + icon (AppMgr writes the folder)
//   await pc.filePut("/sdcard/a.txt", bytes); await pc.fileGet(path); await pc.cmd('ls path="/storage"');
//   pc.type("help"); pc.terminal() -> text; pc.on("text", cb)
import { synthImage, hex, crc32le, K, AppsFlash, AppsRegion, PENDING_REGION, PENDING_SIZE } from "./kapps.js";
import { BundleStore } from "./bundles.js";
import { readPackageInfo, RESET } from "./dotbench-system.js";

const ERASE = "\r\x1b[K";
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const crc32 = (b) => crc32le(0, b);                   // == zlib.crc32 (what the console protocol carries)
const kfwCrc = (b) => crc32le(0xffffffff, b);          // kfw_crc32(): the container's own header and app-data CRCs (seed UINT32_MAX)
export const quote = (s) => '"' + String(s).replace(/(["\\])/g, "\\$1") + '"';
export class UsbError extends Error { constructor(msg, term) { super(msg); this.term = term; } }

export class UsbComputer {
  /** @param {import("./dotbench-system.js").DotbenchSystem} sys */
  constructor(sys, { host = true } = {}) {
    this.sys = sys; this._want = false; this._host = host;
    this._text = ""; this._partial = ""; this._queue = []; this._waiter = null; this._listeners = new Set(); this._bytesIn = 0;
    this._unsubs = [
      sys.on("area:usb:data", (d) => this._onBytes(d)),
      sys.on("program", () => { if (this._want) setTimeout(() => this._apply(), 0); }),
    ];
  }
  dispose() { for (const u of this._unsubs) u(); }
  get _usb() { return this.sys.area("usb"); }
  _apply() { const u = this._usb; if (u && this._want) { const ok = u.plug(true, { host: this._host }); if (!ok) this._refused = true; return ok; } return false; }

  // ------------------------------------------------------------------ the cable
  /** Plug in. host=false is a plain charger (VBUS only, no console peer). Returns false if the connector is taken by the power area's charger. */
  plug({ host = true } = {}) { this._want = true; this._host = host; this._refused = false; return this._apply(); }
  unplug() { this._want = false; this._partial = ""; this._queue.length = 0; this._wake(); return this._usb?.plug(false) ?? false; }
  get plugged() { return this._usb?.plugged() ?? false; }
  /** The computer opens or closes its serial port with the cable in. */
  setHost(on) { this._host = on; this._usb?.setHost(on); }

  // ------------------------------------------------------------------ the terminal (everything the Dot printed on the cable)
  terminal() { return this._text; }
  clearTerminal() { this._text = ""; }
  on(type, cb) { const f = (e) => { if (e.type === type) cb(e.data); }; this._listeners.add(f); return () => this._listeners.delete(f); }
  _emit(type, data) { for (const f of this._listeners) f({ type, data }); }
  /** Type a line (what a terminal program does). The Dot's line editor echoes it. */
  type(line) { return this._usb ? this._usb.send(line + "\r\n") : 0; }
  _onBytes(d) {
    this._bytesIn += d.length;
    const t = new TextDecoder("latin1").decode(d);
    this._text += t; if (this._text.length > 200000) this._text = this._text.slice(-100000);
    this._emit("text", t);
    this._partial += t;
    let i;
    while ((i = this._partial.indexOf("\n")) >= 0) {
      let line = this._partial.slice(0, i); this._partial = this._partial.slice(i + 1);
      if (line.includes(ERASE)) line = line.split(ERASE).pop();           // keep what the erase reveals (kcli.py read_line)
      line = line.replace(ANSI, "").replace(/\r+$/, "").replace(/^\r+/, "");
      if (line) { this._queue.push(line); this._wake(); }
    }
    // a record can be waiting without its newline only briefly; the Dot always ends lines with \r\n
  }
  _wake() { const w = this._waiter; this._waiter = null; if (w) w(); }
  async _readLine(deadline) {
    for (;;) {
      if (this._queue.length) return this._queue.shift();
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await new Promise((res) => { this._waiter = res; setTimeout(res, Math.min(left, 100)); });
    }
  }
  drain() { this._queue.length = 0; this._partial = ""; }

  // ------------------------------------------------------------------ the console protocol (kcli.py)
  _send(line) { if (!this._usb?.up()) throw new UsbError("the cable is not plugged in with a computer attached"); this._usb.send(line + "\r\n"); }
  /** Response lines until a terminator (or `stop` matches a record). -> {records, term}; term is null when the time ran out. */
  async collect(timeout, { stop, idle = false } = {}) {
    let deadline = Date.now() + timeout; const records = [];
    for (;;) {
      const line = await this._readLine(deadline);
      if (line === null) return { records, term: null };
      if (idle) deadline = Date.now() + timeout;
      if (line.startsWith(">|")) { records.push(line.slice(2)); if (stop && stop(line.slice(2))) return { records, term: line }; }
      else if (line.startsWith(">ok") || line.startsWith(">err")) return { records, term: line };
    }
  }
  /** One ordinary command. */
  async command(line, timeout = 5000) { this.drain(); this._send(line); return this.collect(timeout); }
  /** command() that throws on anything but `>ok`; returns the records. */
  async cmd(line, timeout = 5000) {
    const { records, term } = await this.command(line, timeout);
    if (term === null) throw new UsbError(line.split(" ")[0] + ": no terminator (timeout)");
    if (!term.startsWith(">ok")) throw new UsbError(line.split(" ")[0] + ": " + term, term);
    return records;
  }
  async ping(timeout = 5000) { const r = await this.cmd("ping", timeout); return r[0] ?? "pong"; }

  /** The conversation `install src="terminal"` and `file_put` share (kcli.py stream_payload). `cmd` opens it; `data` follows in the
   *  windows the board announced, each closed by `>|ack`; the terminator comes after the last byte.
   *  opts: onProgress(sent,total); readyTimeout; closeTimeout; ackTimeout; abortAfter (bytes: stop sending, as an unplugged cable would;
   *  `onAbort` runs there, typically unplug()). */
  async stream(data, cmd, what, opts = {}) {
    const { onProgress, readyTimeout = 12000, closeTimeout = 30000, ackTimeout = 10000, abortAfter = null, onAbort } = opts;
    this.drain();
    this._send(cmd);
    const rd = await this.collect(readyTimeout, { stop: (r) => r.startsWith("ready") });
    if (rd.term === null) throw new UsbError(what + ": board never said ready");
    if (rd.term.startsWith(">err")) throw new UsbError(what + ": " + rd.term, rd.term);
    const evicted = rd.records.filter((r) => r.startsWith("evicted"));
    const step = Number(/\bchunk=(\d+)/.exec(rd.term)?.[1] ?? 4096);
    let sent = 0;
    while (sent < data.length) {
      const n = Math.min(step, data.length - sent);
      if (abortAfter !== null && sent >= abortAfter) { await onAbort?.(); throw new UsbError(what + ": the cable went away at " + sent + "/" + data.length + " bytes"); }
      if (!this._usb?.up()) throw new UsbError(what + ": the cable is not plugged in");
      this._usb.send(data.subarray(sent, sent + n));
      sent += n;
      if (n === step) {                                             // a full window earns an ack; the last partial one does not
        const a = await this.collect(ackTimeout, { stop: (r) => r === "ack" });
        if (a.term === null) throw new UsbError(what + ": no ack at " + sent + "/" + data.length + " bytes");
        if (a.term.startsWith(">err")) throw new UsbError(what + ": " + a.term, a.term);
      }
      onProgress?.(sent, data.length);
    }
    const c = await this.collect(closeTimeout);
    if (c.term === null) throw new UsbError(what + ": no terminator (timeout)");
    if (!c.term.startsWith(">ok")) throw new UsbError(what + ": " + c.term, c.term);
    return { evicted, records: c.records };
  }

  /** `kcli file-put LOCAL REMOTE`. */
  filePut(path, data, opts) { return this.stream(data, `file_put path=${quote(path)} size=${data.length} crc32=${crc32(data)}`, "file_put", opts); }
  /** `kcli file-get`: the board sends base64 `>|d=` records after a header record. -> Uint8Array */
  async fileGet(path, { idle = 15000 } = {}) {
    this.drain(); this._send(`file_get name=${quote(path)}`);
    const parts = []; let head = null;
    for (;;) {
      const line = await this._readLine(Date.now() + idle);
      if (line === null) throw new UsbError("file_get: the board went quiet before the terminator");
      if (line.startsWith(">|d=")) parts.push(line.slice(4));
      else if (line.startsWith(">|")) head = line.slice(2);
      else if (line.startsWith(">ok")) break;
      else if (line.startsWith(">err")) throw new UsbError("file_get: " + line, line);
    }
    const bin = atob(parts.join(""));
    return { head, data: Uint8Array.from(bin, (c) => c.charCodeAt(0)) };
  }

  // ------------------------------------------------------------------ installing an app
  /** `kcli install app.bin` (direct): stream an image; the real AppMgr writes the apps region while the bytes arrive. */
  install(image, { run = false, name } = {}) {
    const cmd = `install src="terminal" dst=app size=${image.length} crc32=${crc32(image)} run=${run ? "on" : "off"}` + (name ? ` name=${quote(name)}` : "");
    return this.stream(image, cmd, "install");
  }
  /** `kcli install --dst pending`: park the bytes undecoded in the mailbox. */
  park(image) { return this.stream(image, `install src="terminal" dst=pending size=${image.length} crc32=${crc32(image)}`, "install"); }
  /** `install src="pending" dst=app`: AppMgr adopts what the mailbox holds. The `>ok` says it was accepted; the adoption reports in the log. */
  adopt({ run = false } = {}) { return this.cmd(`install src="pending" dst=app run=${run ? "on" : "off"}`, 20000); }
  /** `kcli appdata put NAME DIR`: mkdir x3, file_put app.json (+ icon.k64), then `appdata_info`. */
  async appdataPut(project, json, icon) {
    const base = "/storage/.kode/appsdata/" + project;
    for (const d of ["/storage/.kode", "/storage/.kode/appsdata", base]) {
      const { term } = await this.command(`mkdir path=${quote(d)}`);
      if (term === null) throw new UsbError("mkdir: no terminator");
      if (!term.startsWith(">ok") && !term.includes("msg=exists")) throw new UsbError("mkdir " + d + ": " + term, term);
    }
    await this.filePut(base + "/app.json", json);
    if (icon?.length) await this.filePut(base + "/icon.k64", icon);
    return this.cmd(`appdata_info name=${quote(project)}`);
  }

  /** What the page needs from a .dotbench to install it, and the image that stands for it (no machine code: its KAPD descriptor carries
   *  the bundle id). Registers the bundle first (see the file header). -> {image, info, id, project} */
  async prepare(bytes) {
    const info = await readPackageInfo(bytes);
    const id = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
    const a = info.appJson;
    const image = synthImage({ project: a.name, version: a.version ?? "0.0.0", name: a.display_name ?? a.name, category: a.category ?? "", buildId: Uint8Array.from(id.match(/../g), (h) => parseInt(h, 16)) });
    new BundleStore(this.sys.pm).put(id, bytes, { project: a.name, name: a.display_name ?? a.name, version: a.version ?? "" });
    return { image, info, id, project: a.name };
  }
  /** KFW1 container (kdrv_kfw.h), uncompressed, for the app target, optionally with the KAD1 app-data block. */
  static container(image, project, { json, icon } = {}) {
    const ad = json ? (() => { const b = new Uint8Array(12 + json.length + (icon?.length ?? 0)), v = new DataView(b.buffer);
      v.setUint32(0, 0x3144414b, true); v.setUint16(4, json.length, true); v.setUint16(6, icon?.length ?? 0, true);
      b.set(json, 12); if (icon) b.set(icon, 12 + json.length); v.setUint32(8, kfwCrc(b.subarray(12)), true); return b; })() : new Uint8Array(0);
    const h = new Uint8Array(72), v = new DataView(h.buffer);
    v.setUint32(0, K.KFW_MAGIC, true); v.setUint16(4, 1, true); v.setUint16(6, 72, true); h[8] = 1; h[9] = 0; v.setUint16(10, json ? 1 : 0, true);
    v.setUint32(12, image.length, true); v.setUint32(16, image.length, true);
    return { head: h, ad, image, project };
  }
  static async _containerBytes(c) {
    const sha = new Uint8Array(await crypto.subtle.digest("SHA-256", c.image));
    c.head.set(sha, 20); const v = new DataView(c.head.buffer);
    v.setUint32(52, kfwCrc(c.head.subarray(0, 52)), true);
    c.head.fill(0, 56, 72); c.head.set(new TextEncoder().encode(c.project).subarray(0, 15), 56);
    const out = new Uint8Array(72 + c.ad.length + c.image.length); out.set(c.head); out.set(c.ad, 72); out.set(c.image, 72 + c.ad.length);
    return out;
  }

  /** Install a .dotbench the way the real tools install an app. opts: via "direct" (default) | "mailbox"; run; container (send a KFW1
   *  container whose app-data block carries app.json + icon, so AppMgr writes the folder itself; otherwise `appdata put` follows);
   *  appdata=false to skip the folder. -> {id, project, evicted} */
  async installPackage(bytes, { via = "direct", run = false, container = false, appdata = true, ...opts } = {}) {
    const { image, info, id, project } = await this.prepare(bytes);
    const json = info.board.json, icon = info.board.icon;
    let payload = image;
    if (container) payload = await UsbComputer._containerBytes(UsbComputer.container(image, project, { json: json ?? undefined, icon: icon ?? undefined }));
    let res;
    // `appdata put` first: with run=on the board reboots into the app right behind the install's >ok, and an app has no console
    if (appdata && !container && json) await this.appdataPut(project, json, icon ?? undefined);
    if (via === "mailbox") { await this.park(payload); await this.adopt({ run }); }
    else res = await this.stream(payload, `install src="terminal" dst=app size=${payload.length} crc32=${crc32(payload)} run=${run ? "on" : "off"} name=${quote(project)}`, "install", opts);
    return { id, project, evicted: res?.evicted ?? [] };
  }

  /** The development path (esptool / JTAG writing app_pending), with the board off: write the image into the mailbox and power-on reset,
   *  so the boot-time adoption (AppMgr_initial) installs it. The cable is not involved. */
  async flashMailbox(bytes) {
    const { image, info, project } = await this.prepare(bytes);
    const sys = this.sys;
    await sys._run(async () => {
      sys._quiesce();
      const f = new AppsFlash(sys.pm, PENDING_REGION, PENDING_SIZE);
      f.erase(0, Math.ceil(image.length / 4096) * 4096); f.program(0, image);
      await sys.pm.flush();
      await sys._boot(RESET.POWERON, true);
    });
    return { project, info };
  }
}
