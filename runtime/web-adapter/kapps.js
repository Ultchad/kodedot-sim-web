// The `apps` flash region, host side: the hardware-independent parts of kdrv_apps.c / appmgr_ao.c / bootloader_start.c that the
// page needs (the page plays the bootloader and installs the factory set while the firmware is not running).
// Source of truth for every constant and rule: SDK components/kdrv/apps/include/kapps_fmt.h (format), kdrv_apps.c (directory
// commit, plan), kaos/appmgr/src/appmgr_ao.c (compact, upsert, FIFO), KodeOS bootloader_components/main/bootloader_start.c.
// The firmware side is the REAL kdrv_apps.c (runtime/drivers/apps), so what this file writes is read by the SDK's own code
// (tests/node/boot proves it by booting kodeOS on a region this file built).
//
// The region lives in a persistent region (runtime/drivers/apps/apps_flash_web.c) that holds the COMPLEMENT of the flash bytes, so
// erased flash (0xFF) is all-zero and the sparse mirror stores nothing for it. AppsFlash below hides that: it reads and
// programs real NOR flash semantics (erase = 0xFF, a program can only clear bits).

export const K = {
  DIR_MAGIC: 0x5050414b, REQ_MAGIC: 0x4e55524b, OS_INTENT_MAGIC: 0x41544f4b, KFW_MAGIC: 0x3157464b, FMT_VERSION: 1,
  DIR_A_OFF: 0x0000, DIR_B_OFF: 0x1000, REQ_OFF: 0x2000, DATA_OFF: 0x10000, ALIGN: 0x10000, MAX_ENTRIES: 64, ENTRY_VALID: 1,
  REQ_LEN: 20, REQ_STATE_AT: 16,
  STATE: { EMPTY: 0xffffffff, NEW: 0xaaaaaaaa, ALWAYS: 0x55555555, ARMED: 0x00005555, TRIED: 0x00000000 },
  DIR_LEN: 16 + 64 * 16 + 4,
  // esp_app_desc_t / kapp_desc_t / image header
  IDF_DESC_OFF: 0x20, DESC_OFF: 0x120, DESC_LEN: 136, APP_DESC_MAGIC: 0xabcd5432, KAPD_MAGIC: 0x4450414b, KAPD_VERSION: 2,
  IMAGE_MAGIC: 0xe9, CHIP_ESP32P4: 0x12, NO_VICTIM: 0xff, SECTOR: 0x1000,
};
// Reset causes as the P4 ROM numbers them (kapps_fmt.h): the closed list that keeps an ARMED request standing.
export const ROM = { POWERON: 0x01, CORE_SW: 0x03, DEEP_SLEEP: 0x05, CPU_SW: 0x0c, WDT: 0x0f, USB_JTAG: 0x16, USB_UART: 0x17, CPU_JTAG: 0x18 };
export const causeKeeps = (c) => [ROM.CORE_SW, ROM.DEEP_SLEEP, ROM.CPU_SW, ROM.USB_JTAG, ROM.USB_UART, ROM.CPU_JTAG].includes(c);

/** Sizes of the two persistent regions (must equal runtime/drivers/apps/apps_flash_web.c; tests/node/boot checks it against a running module). */
export const APPS_REGION = "apps", PENDING_REGION = "app-pending";
export const APPS_SIZE = K.DATA_OFF + K.MAX_ENTRIES * K.ALIGN;      // 64 images of 64 KB on top of the directory/request area
export const PENDING_SIZE = 0x100000;                              // the mailbox; its intent sector is its last 4 KB

// ---- CRC-32 as esp_rom_crc32_le(crc, buf, len): the ROM inverts on entry and exit, so UINT32_MAX in = a plain CRC-32 from 0.
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32le(crc, bytes) {
  crc = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
  return ~crc >>> 0;
}

const dec = new TextDecoder(), enc = new TextEncoder();
const cstr = (u8, o, n) => { let e = o; while (e < o + n && u8[e]) e++; return dec.decode(u8.subarray(o, e)); };
const putStr = (u8, o, n, s) => { u8.fill(0, o, o + n); u8.set(enc.encode(s).subarray(0, n - 1), o); };
const alignUp = (n) => (n + K.ALIGN - 1) & ~(K.ALIGN - 1) >>> 0;

/** NOR flash over a persistent region that stores the complement. `pm` is a PersistManager. */
export class AppsFlash {
  constructor(pm, name = APPS_REGION, size = APPS_SIZE) { this.pm = pm; this.name = name; this.size = size; }
  read(off, len) {
    if (off < 0 || off + len > this.size) throw new Error("flash read out of range");
    const s = this.pm.regionRead(this.name, off, len);
    for (let i = 0; i < s.length; i++) s[i] ^= 0xff;
    return s;
  }
  /** Program: flash bits can only go 1 -> 0. */
  program(off, data) {
    if (off < 0 || off + data.length > this.size) throw new Error("flash program out of range");
    const stored = this.pm.regionRead(this.name, off, data.length);      // = ~flash
    for (let i = 0; i < data.length; i++) stored[i] |= ~data[i] & 0xff;  // ~(flash & data)
    this.pm.regionWrite(this.name, off, stored, this.size);
  }
  erase(off, len) {
    if (off % K.SECTOR || len % K.SECTOR) throw new Error("flash erase must be sector aligned");
    this.pm.regionWrite(this.name, off, new Uint8Array(len), this.size);   // stored 0 = flash 0xFF
  }
}

// ---- the directory ------------------------------------------------------------------------------------------------
/** @returns {{magic, version, gen, count, e: {offset,size,seq,flags}[], crc, crcOk}} */
export function decodeDir(b) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const d = { magic: v.getUint32(0, true), version: v.getUint32(4, true), gen: v.getUint32(8, true), count: v.getUint32(12, true), e: [], crc: v.getUint32(K.DIR_LEN - 4, true) };
  for (let i = 0; i < K.MAX_ENTRIES; i++) {
    const o = 16 + i * 16;
    d.e.push({ offset: v.getUint32(o, true), size: v.getUint32(o + 4, true), seq: v.getUint32(o + 8, true), flags: v.getUint32(o + 12, true) });
  }
  d.crcOk = crc32le(0xffffffff, b.subarray(0, K.DIR_LEN - 4)) === d.crc;
  return d;
}
export function encodeDir(d) {
  const b = new Uint8Array(K.DIR_LEN), v = new DataView(b.buffer);
  v.setUint32(0, K.DIR_MAGIC, true); v.setUint32(4, K.FMT_VERSION, true); v.setUint32(8, d.gen >>> 0, true); v.setUint32(12, d.count, true);
  for (let i = 0; i < K.MAX_ENTRIES; i++) {
    const e = d.e[i] ?? { offset: 0, size: 0, seq: 0, flags: 0 }, o = 16 + i * 16;
    v.setUint32(o, e.offset, true); v.setUint32(o + 4, e.size, true); v.setUint32(o + 8, e.seq, true); v.setUint32(o + 12, e.flags, true);
  }
  v.setUint32(K.DIR_LEN - 4, crc32le(0xffffffff, b.subarray(0, K.DIR_LEN - 4)), true);
  return b;
}
export const reqBoundsOk = (offset, size, regionSize) =>
  K.DATA_OFF <= offset && offset % K.ALIGN === 0 && size !== 0 && offset <= regionSize && regionSize - offset >= size;
/** kapps_dir_classify: "ok" | "blank" | "corrupt" | "foreign" */
export function classifyDir(d, regionSize) {
  if (d.magic === 0xffffffff) return "blank";
  if (d.magic !== K.DIR_MAGIC) return "corrupt";
  if (d.version !== K.FMT_VERSION) return "foreign";
  if (!d.crcOk || d.count > K.MAX_ENTRIES) return "corrupt";
  for (let i = 0; i < d.count; i++) if ((d.e[i].flags & K.ENTRY_VALID) && !reqBoundsOk(d.e[i].offset, d.e[i].size, regionSize)) return "corrupt";
  return "ok";
}

/** kdrv_apps_plan(): where an image of `imgSize` bytes lands and who is evicted. Next-fit after the newest install, FIFO eviction.
 *  @returns {{offset, evict: number[], slotVictim: number, replaced: number}|null} null = cannot fit even in an empty region */
export function planInstall(d, regionSize, imgSize, replacing = K.NO_VICTIM, copied = 0n) {
  const need = alignUp(imgSize);
  if (K.DATA_OFF >= regionSize || need === 0 || regionSize - K.DATA_OFF < need) return null;
  let live = [];
  for (let i = 0; i < Math.min(K.MAX_ENTRIES, d.count); i++) if (d.e[i].flags & K.ENTRY_VALID) live.push({ idx: i, offset: d.e[i].offset, size: d.e[i].size, seq: d.e[i].seq });
  const first = (a, b) => {
    const ac = ((copied >> BigInt(a.idx)) & 1n) !== 0n, bc = ((copied >> BigInt(b.idx)) & 1n) !== 0n;
    return ac !== bc ? ac : a.seq < b.seq;
  };
  const out = { offset: 0, evict: [], slotVictim: K.NO_VICTIM, replaced: K.NO_VICTIM };
  for (;;) {
    live.sort((a, b) => a.offset - b.offset);
    let searchStart = K.DATA_OFF;
    if (live.length) {
      let newest = live[0];
      for (const l of live) if (l.seq > newest.seq) newest = l;
      searchStart = alignUp(newest.offset + newest.size);
    }
    let found = false, foundOffset = 0;
    for (let pass = 0; pass < 2 && !found; pass++) {
      let prevEnd = K.DATA_OFF;
      for (let i = 0; i <= live.length; i++) {
        const gapStart = prevEnd, gapEnd = i < live.length ? live[i].offset : regionSize;
        if (i < live.length) prevEnd = alignUp(live[i].offset + live[i].size);
        if (gapEnd <= gapStart) continue;
        const inPass = pass === 0 ? gapStart >= searchStart : gapStart < searchStart;
        if (inPass && gapEnd - gapStart >= need) { foundOffset = gapStart; found = true; break; }
      }
    }
    if (found) {
      out.offset = foundOffset;
      let replacesLive = false, oldest = live[0];
      for (const l of live) { if (l.idx === replacing) replacesLive = true; if (first(l, oldest)) oldest = l; }
      if (K.MAX_ENTRIES <= live.length && !replacesLive) out.slotVictim = oldest.idx;
      return out;
    }
    if (!live.length) return null;
    let victim = 0, same = false;
    for (let i = 0; i < live.length; i++) {
      if (live[i].idx === replacing) { victim = i; same = true; break; }
      if (first(live[i], live[victim])) victim = i;
    }
    if (same) out.replaced = replacing;
    out.evict.push(live[victim].idx);
    live[victim] = live[live.length - 1]; live.pop();
  }
}

// ---- the images the page synthesises (a .dotbench has no machine code, but the region holds the device's own format) --------------
/** Bytes of the image for a dotbench app: a well-formed ESP image of one segment (so the SDK's header walk and checksum hold),
 *  whose segment data is esp_app_desc_t (project name, version, build id = the bundle's SHA-256) then kapp_desc_t ("KAPD":
 *  display name, category). `buildId` is 32 bytes. */
export function synthImage({ project, version, name, category = "", buildId, date = "Nov 16 2026", time = "00:00:00" }) {
  const L = 256 + K.DESC_LEN;                         // segment data: the two descriptors
  const end = 32 + L, total = (end | 15) + 1;
  const b = new Uint8Array(total), v = new DataView(b.buffer);
  b[0] = K.IMAGE_MAGIC; b[1] = 1; b[2] = 2; b[3] = 0x2f;                       // magic, 1 segment, dio, 16 MB @ 80 MHz
  v.setUint32(4, 0x4ff00000, true); b[8] = 0xee; v.setUint16(12, K.CHIP_ESP32P4, true); v.setUint16(15, 0, true); v.setUint16(17, 0xffff, true);
  v.setUint32(24, 0x40000020, true); v.setUint32(28, L, true);                 // segment header: load address, length
  const d = K.IDF_DESC_OFF;
  v.setUint32(d, K.APP_DESC_MAGIC, true);
  putStr(b, d + 16, 32, version); putStr(b, d + 48, 32, project); putStr(b, d + 80, 16, time); putStr(b, d + 96, 16, date); putStr(b, d + 112, 32, "v6.1 (dotbench)");
  b.set(buildId.subarray(0, 32), d + 144); b[d + 180] = 16;                    // app_elf_sha256, mmu_page_size
  const k = K.DESC_OFF;
  v.setUint32(k, K.KAPD_MAGIC, true); v.setUint32(k + 4, K.KAPD_VERSION, true);
  putStr(b, k + 8, 32, name); putStr(b, k + 40, 64, category);
  let x = 0xef; for (let i = 32; i < end; i++) x ^= b[i];
  b[total - 1] = x;                                                           // the checksum byte closes the 16-byte-padded image
  return b;
}
/** esp_image_verify() as far as it is meaningful here: header, segment walk (kdrv_image_walk_len), checksum. No SHA-256 (none appended). */
export function walkImage(b) {
  if (b.length < 24 || b[0] !== K.IMAGE_MAGIC || b[1] === 0 || b[1] > 16) return 0;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let off = 24, x = 0xef;
  for (let i = 0; i < b[1]; i++) {
    if (off + 8 > b.length) return 0;
    const n = v.getUint32(off + 4, true);
    if (b.length - off - 8 < n) return 0;
    for (let j = 0; j < n; j++) x ^= b[off + 8 + j];
    off += 8 + n;
  }
  off = (off | 15) + 1;
  if (off > b.length || b[off - 1] !== x) return 0;
  return off + (b[23] ? 32 : 0) <= b.length ? off + (b[23] ? 32 : 0) : 0;
}
/** What the region says about an image: kdrv_apps_desc(). `prefix` = first 0x1A8 bytes. */
export function describeImage(prefix) {
  const v = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength), d = K.IDF_DESC_OFF;
  if (prefix.length < K.DESC_OFF || v.getUint32(d, true) !== K.APP_DESC_MAGIC) return null;
  const out = { project: cstr(prefix, d + 48, 32), version: cstr(prefix, d + 16, 32), buildId: prefix.slice(d + 144, d + 176), name: "", category: "" };
  if (prefix.length >= K.DESC_OFF + K.DESC_LEN && v.getUint32(K.DESC_OFF, true) === K.KAPD_MAGIC) {
    out.name = cstr(prefix, K.DESC_OFF + 8, 32); out.category = cstr(prefix, K.DESC_OFF + 40, 64);
  }
  return out;
}
export const hex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, "0")).join("");
export const unhex = (s) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));

// ---- the region as a whole ---------------------------------------------------------------------------------------------
export class AppsRegion {
  /** @param {AppsFlash} flash */
  constructor(flash) { this.flash = flash; this.size = flash.size; this.dir = null; this.active = K.DIR_A_OFF; }

  /** kdrv_apps_init(): pick a copy by generation, or format. Returns what the region was ("ok"|"formatted"|"foreign"). */
  load() {
    const rd = (o) => { const d = decodeDir(this.flash.read(o, K.DIR_LEN)); return { d, kind: classifyDir(d, this.size) }; };
    const a = rd(K.DIR_A_OFF), b = rd(K.DIR_B_OFF);
    if (a.kind === "foreign" || b.kind === "foreign") { this.dir = null; return "foreign"; }
    const aok = a.kind === "ok", bok = b.kind === "ok";
    if (aok && (!bok || a.d.gen >= b.d.gen)) { this.dir = a.d; this.active = K.DIR_A_OFF; return "ok"; }
    if (bok) { this.dir = b.d; this.active = K.DIR_B_OFF; return "ok"; }
    const fresh = { gen: 1, count: 0, e: [] };
    this._writeDir(K.DIR_A_OFF, fresh);
    this.flash.erase(K.DIR_B_OFF, K.SECTOR);
    this.dir = decodeDir(encodeDir(fresh)); this.active = K.DIR_A_OFF;
    return "formatted";
  }
  _writeDir(off, d) {
    const b = encodeDir(d);
    this.flash.erase(off, K.SECTOR);
    this.flash.program(off + 4, b.subarray(4));      // everything after the magic first...
    this.flash.program(off, b.subarray(0, 4));       // ...then the magic: only a whole copy carries it
  }
  /** kdrv_apps_dir_commit(): write the inactive copy with gen+1; adopt it once written. */
  commit(next) {
    const d = { gen: this.dir.gen + 1, count: next.count, e: next.e.slice(0, next.count) };
    const target = this.active === K.DIR_A_OFF ? K.DIR_B_OFF : K.DIR_A_OFF;
    this._writeDir(target, d);
    this.dir = decodeDir(encodeDir(d)); this.active = target;
  }
  entries() { return this.dir.e.slice(0, this.dir.count).filter((e) => e.flags & K.ENTRY_VALID); }
  describe(e) { return describeImage(this.flash.read(e.offset, Math.min(e.size, K.DESC_OFF + K.DESC_LEN))); }
  /** The installed apps: [{index, offset, size, seq, project, version, name, category, buildId(hex)}] in install order. */
  list() {
    return this.dir.e.slice(0, this.dir.count).map((e, index) => ({ e, index })).filter(({ e }) => e.flags & K.ENTRY_VALID).map(({ e, index }) => {
      const d = this.describe(e);
      return { index, offset: e.offset, size: e.size, seq: e.seq, project: d?.project ?? "", version: d?.version ?? "", name: d?.name ?? "", category: d?.category ?? "", buildId: d ? hex(d.buildId) : "" };
    });
  }
  findProject(project) { return this.list().find((a) => a.project === project) ?? null; }

  /** The install the firmware's AppMgr does for an image (flash_finish): replace a namesake, evict by the plan, write, commit once.
   *  @returns {{offset, evicted: string[]}} evicted = project names that lost their place (their bundles/appsdata are the caller's to drop) */
  install(image) {
    const desc = describeImage(image);
    if (!desc) throw new Error("image has no esp_app_desc_t");
    if (!walkImage(image)) throw new Error("image does not verify");
    const dir = { gen: this.dir.gen, count: this.dir.count, e: this.dir.e.slice(0, this.dir.count).map((e) => ({ ...e })) };
    const same = this.findProject(desc.project);
    const plan = planInstall(dir, this.size, image.length, same ? same.index : K.NO_VICTIM);
    if (!plan) throw new Error("the image does not fit the region");
    const evicted = [];
    for (const i of plan.evict) { const d = this.describe(dir.e[i]); if (d && d.project !== desc.project) evicted.push(d.project); dir.e[i].flags = 0; }
    const compact = () => { dir.e = dir.e.filter((e) => e.flags); dir.count = dir.e.length; };
    if (same) { const j = dir.e.findIndex((e) => e.offset === same.offset && (e.flags & K.ENTRY_VALID)); if (j >= 0) dir.e[j].flags = 0; }
    compact();
    if (dir.count >= K.MAX_ENTRIES) {                                    // appdir_make_room(): the oldest goes
      let oldest = 0;
      for (let i = 1; i < dir.count; i++) if (dir.e[i].seq < dir.e[oldest].seq) oldest = i;
      const d = this.describe(dir.e[oldest]); if (d) evicted.push(d.project);
      dir.e[oldest].flags = 0; compact();
    }
    const seq = dir.e.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    // the directory first, so the flash the victims held is free before the write (as flash_finish orders it); then the image
    this.commit(dir);
    this.flash.erase(plan.offset, alignUp(image.length));
    this.flash.program(plan.offset, image);
    const back = this.flash.read(plan.offset, image.length);
    if (!walkImage(back)) throw new Error("image written does not verify");
    dir.e.push({ offset: plan.offset, size: image.length, seq, flags: K.ENTRY_VALID }); dir.count = dir.e.length;
    this.commit(dir);
    return { offset: plan.offset, evicted };
  }
  /** erase_begin(): drop the entry, then erase its header. */
  remove(project) {
    const a = this.findProject(project);
    if (!a) return false;
    const dir = { gen: this.dir.gen, count: this.dir.count, e: this.dir.e.slice(0, this.dir.count).map((e) => ({ ...e })) };
    dir.e[a.index].flags = 0; dir.e = dir.e.filter((e) => e.flags); dir.count = dir.e.length;
    this.commit(dir);
    this.flash.erase(a.offset, K.SECTOR);
    return true;
  }

  // ---- the boot request: kdrv_apps_req_*
  readReq() {
    const b = this.flash.read(K.REQ_OFF, K.REQ_LEN), v = new DataView(b.buffer);
    const req = { magic: v.getUint32(0, true), offset: v.getUint32(4, true), size: v.getUint32(8, true), crc: v.getUint32(12, true), state: v.getUint32(16, true) };
    req.crcOk = req.magic === K.REQ_MAGIC && crc32le(0xffffffff, b.subarray(0, 12)) === req.crc;
    return req;
  }
  writeReq(offset, size, state) {
    if (state !== K.STATE.NEW && state !== K.STATE.ALWAYS) throw new Error("a boot request is NEW or ALWAYS");
    if (!reqBoundsOk(offset, size, this.size)) throw new Error("boot request out of bounds");
    const b = new Uint8Array(K.REQ_LEN), v = new DataView(b.buffer);
    v.setUint32(0, K.REQ_MAGIC, true); v.setUint32(4, offset, true); v.setUint32(8, size, true);
    v.setUint32(12, crc32le(0xffffffff, b.subarray(0, 12)), true); v.setUint32(16, state, true);
    this.flash.erase(K.REQ_OFF, K.SECTOR);
    this.flash.program(K.REQ_OFF, b);
  }
  clearReq() { this.flash.erase(K.REQ_OFF, K.SECTOR); }
  /** The bootloader's write: only the state word, only clearing bits. */
  writeReqState(state) {
    const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, state, true);
    this.flash.program(K.REQ_OFF + K.REQ_STATE_AT, b);
  }
}

/** try_boot_requested_app() of the real bootloader. `cause` = the ROM's reset reason; `mailboxFull` = an image waits in app_pending.
 *  Mutates the request exactly as the bootloader does (NEW -> TRIED, ALWAYS -> ARMED, retire a sticky one that no longer stands, TRIED on
 *  a bad image). @returns {{offset, size, project, version, buildId, state}|null} the app to boot, or null: boot kodeOS */
export function tryBootRequestedApp(region, cause, mailboxFull = false) {
  const req = region.readReq();
  if (!req.crcOk) return null;
  if (!(req.state === K.STATE.NEW || req.state === K.STATE.ALWAYS || req.state === K.STATE.ARMED)) return null;     // kapps_req_live
  if (!reqBoundsOk(req.offset, req.size, region.size)) return null;
  if (req.state === K.STATE.ARMED) {
    const keep = causeKeeps(cause) && !mailboxFull;                                                              // kapps_req_armed_stands
    if (!keep) { region.writeReqState(K.STATE.TRIED); return null; }
  }
  const img = region.flash.read(req.offset, req.size);
  if (!walkImage(img)) { region.writeReqState(K.STATE.TRIED); return null; }                                       // does not verify: TRIED from any state
  const next = req.state === K.STATE.NEW ? K.STATE.TRIED : req.state === K.STATE.ALWAYS ? K.STATE.ARMED : req.state;   // kapps_req_next_state
  if (next !== req.state) region.writeReqState(next);
  const d = describeImage(img.subarray(0, K.DESC_OFF + K.DESC_LEN));
  return { offset: req.offset, size: req.size, project: d?.project ?? "", version: d?.version ?? "", name: d?.name ?? "", buildId: d ? hex(d.buildId) : "", state: req.state };
}
