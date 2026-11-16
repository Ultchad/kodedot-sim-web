// SPDX-License-Identifier: GPL-3.0-or-later
// 125 kHz RFID bench glue. Default export: (ctx) => api (the guide's contract). Named exports are pure helpers
// (EM4100 formats and frame encoder) usable without a device.
//
// Objects are plain JSON:
//   card   { name?, id: "01:02:03:04:05", rf?: 16|32|64 }                       read-only EM4100 fob
//   tag    { name?, id?: "01:..", blocks?: [8 x u32], writeProtected?, needBoost?, locks?: 8-bit mask }
//          rewritable T5577; `id` pre-programs it as an EM4100 tag (config + two data blocks), none = factory blank
//   reader { name?, expectedId?: "01:..", fieldHz?: 125000, fieldOn?: true, delayMs?: 50 }   door reader
//
// api:
//   createCard(j) / createTag(j) / createReader(j) -> snapshot (has .key)       update(key, patch) -> snapshot
//   remove(key)   bringNear(key)   takeAway(key)   isNear(key)   get(key)   list()
//   carrier()   -> { on, boost, adcRunning, pullHigh, hz, gaps, programs, rejects }   (what the device is doing)
//   emulation() -> { active, decodes, id, external, clockHz, periodsPerBit }          (the PARLIO loop, as decoded here)
//   setFault({ adcDead?, noCarrier? })     poll()  -> events drained now      reset()
// events (ctx.emit -> dev.on("area:rfid:<type>")); each also returned by poll():
//   carrier {on, hz}   boost {on}   card-read {key, id, rf}   block-written {key, block, data, locked}
//   tag-written {key, id}   write-rejected {key|null, reason}   emulation {active, id, decodes, external, clockHz}
//   reader-saw {key, visible, id, match, count}   field-measured {hz}   object-left {key, why}
// scripted removal (deterministic "taken away mid-operation"): card/tag option leaveAfterSamples = n demod samples
// modulated, tag option leaveAfterBlocks = n programmed blocks; the object then leaves the antenna (event object-left).

const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");

/** Parse an EM4100 ID: "01:02:03:04:05", "01-02-..", "01 02 ..", "0102030405", "0x..", 5 numbers/bytes, {version, number}. */
export function parseId(v) {
  let bytes;
  if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Uint8Array) && "version" in v) {
    const { version, number } = v;
    if (!Number.isInteger(version) || version < 0 || version > 255 || !Number.isInteger(number) || number < 0 || number > 0xffffffff)
      throw new Error("bad EM4100 version/number");
    bytes = [version, (number >>> 24) & 255, (number >>> 16) & 255, (number >>> 8) & 255, number & 255];
  } else if (typeof v === "string") {
    let s = v.trim().replace(/^0x/i, "");
    if (/[:\- ]/.test(s)) {
      const parts = s.split(/[:\- ]+/);
      if (parts.length !== 5 || !parts.every((p) => /^[0-9a-fA-F]{1,2}$/.test(p))) throw new Error(`an EM4100 ID is 5 bytes ('${v}')`);
      bytes = parts.map((p) => parseInt(p, 16));
    } else {
      if (!/^[0-9a-fA-F]{10}$/.test(s)) throw new Error(`an EM4100 ID is 5 bytes ('${v}')`);
      bytes = s.match(/../g).map((p) => parseInt(p, 16));
    }
  } else if (v && v.length === 5) {
    bytes = Array.from(v);
  } else throw new Error("an EM4100 ID is 5 bytes");
  if (!bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) throw new Error("an EM4100 ID byte is 0..255");
  return Uint8Array.from(bytes);
}

/** The usual renderings of a 40-bit ID: version/customer byte + 32-bit number. */
export function formatId(v, style = "hex") {
  const b = parseId(v);
  const number = ((b[1] << 24) | (b[2] << 16) | (b[3] << 8) | b[4]) >>> 0;
  switch (style) {
    case "hex": return Array.from(b, hex2).join(":");
    case "plain": return Array.from(b, hex2).join("");
    case "dec10": return String(number).padStart(10, "0");              // the number printed on a fob
    case "version": return b[0];
    case "number": return number;
    case "facility-card": return `${String(b[2]).padStart(3, "0")},${String((b[3] << 8) | b[4]).padStart(5, "0")}`;  // 3 bytes, FFF,CCCCC
    default: throw new Error("unknown ID style " + style);
  }
}
export const idFormats = (v) => Object.fromEntries(["hex", "plain", "dec10", "version", "number", "facility-card"].map((s) => [s, formatId(v, s)]));

/** The 64-bit EM4100 frame as a BigInt: 9 header ones, ten rows of 4 data bits + even row parity, 4 even column parities, stop 0. */
export function encodeFrame(v) {
  const b = parseId(v);
  const bits = [1, 1, 1, 1, 1, 1, 1, 1, 1];
  const col = [0, 0, 0, 0];
  for (let r = 0; r < 10; r++) {
    const nib = r % 2 ? b[r >> 1] & 15 : b[r >> 1] >> 4;
    let p = 0;
    for (let k = 0; k < 4; k++) { const bit = (nib >> (3 - k)) & 1; bits.push(bit); p ^= bit; col[k] ^= bit; }
    bits.push(p);
  }
  bits.push(...col, 0);
  return bits.reduce((a, bit) => (a << 1n) | BigInt(bit), 0n);
}
export const frameBits = (v) => encodeFrame(v).toString(2).padStart(64, "0").split("").map(Number);

/** Decode a 64-bit frame (BigInt or 64 bits) back to an ID; throws on a bad header, parity or stop bit. */
export function decodeFrame(frame) {
  const bits = Array.isArray(frame) ? frame : frameBits0(frame);
  if (bits.length !== 64) throw new Error("a frame is 64 bits");
  if (!bits.slice(0, 9).every((x) => x === 1)) throw new Error("bad header");
  const nib = []; let p = 9;
  for (let r = 0; r < 10; r++, p += 5) {
    const n = (bits[p] << 3) | (bits[p + 1] << 2) | (bits[p + 2] << 1) | bits[p + 3];
    if ((bits[p] ^ bits[p + 1] ^ bits[p + 2] ^ bits[p + 3]) !== bits[p + 4]) throw new Error(`row parity error in row ${r}`);
    nib.push(n);
  }
  for (let c = 0; c < 4; c++) {
    let par = 0; for (let r = 0; r < 10; r++) par ^= (nib[r] >> (3 - c)) & 1;
    if (par !== bits[p + c]) throw new Error(`column parity error in column ${c}`);
  }
  if (bits[p + 4] !== 0) throw new Error("bad stop bit");
  return Uint8Array.from([0, 1, 2, 3, 4].map((i) => (nib[2 * i] << 4) | nib[2 * i + 1]));
}
const frameBits0 = (f) => BigInt(f).toString(2).padStart(64, "0").split("").map(Number);

/** The T5577 config word the SDK writes for EM4100 (Manchester, RF/64, maxblock 2) and the data blocks of an ID. */
export const T5577_CONFIG_EM4100 = 0x00148040;
export const T5577_BLANK_CONFIG = 0x000880e0;
export function blocksForId(v) {
  const f = encodeFrame(v);
  return [T5577_CONFIG_EM4100, Number(f >> 32n), Number(f & 0xffffffffn), 0, 0, 0, 0, 0];
}
/** What a T5577 with these blocks reads back as, or null: Manchester, RF/16/32/64, a valid frame in the data blocks. */
export function idFromBlocks(blocks) {
  const cfg = blocks[0] >>> 0, rf = [8, 16, 32, 40, 50, 64, 100, 128][(cfg >>> 18) & 7], mod = (cfg >>> 12) & 31, mb = (cfg >>> 5) & 7;
  if (mod !== 8 || mb === 0 || ![16, 32, 64].includes(rf)) return null;
  const bits = [];
  for (let k = 1; k <= mb; k++) for (let i = 31; i >= 0; i--) bits.push((blocks[k] >>> i) & 1);
  for (const inv of [0, 1]) for (let s = 0; s < bits.length; s++) {
    const w = Array.from({ length: 64 }, (_, i) => bits[(s + i) % bits.length] ^ inv);
    try { return decodeFrame(w); } catch { /* not here */ }
  }
  return null;
}

const KIND = { card: 1, tag: 2, reader: 3 };
const EV = { 1: "carrier", 2: "boost", 3: "card-read", 4: "block-written", 5: "tag-id", 6: "emulation", 7: "reader-saw", 8: "field-measured", 9: "write-rejected", 10: "object-left" };
const REJECT = { 1: "no tag in the field", 2: "tag is write protected", 3: "block is locked", 4: "field not boosted", 5: "malformed downlink frame" };

export default function (ctx) {
  const objs = new Map();   // key -> { h, kind, meta }  (echo of the JSON; the live state is C's)
  const byHandle = new Map();
  let seq = 0;

  const call = (n, ...a) => ctx.call(n, ...a);
  const withBytes = (bytes, fn) => { const p = ctx.alloc(bytes.length); ctx.heap().set(bytes, p); try { return fn(p); } finally { ctx.free(p); } };
  const withBuf = (n, fn) => { const p = ctx.alloc(n); ctx.heap().fill(0, p, p + n); try { return fn(p, () => ctx.heap().slice(p, p + n)); } finally { ctx.free(p); } };
  const u32s = (bytes) => new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 2);

  function need(key) { const o = objs.get(key); if (!o) throw new Error(`no such RFID object '${key}'`); return o; }
  function newKey(kind, j) { let k = j.key; if (k == null) { do { k = `${kind}${++seq}`; } while (objs.has(k)); } else if (objs.has(k)) throw new Error(`RFID object '${k}' exists`); return k; }
  function make(kind, j) {
    const h = call("rfid_obj_create", KIND[kind]);
    if (h < 0) throw new Error("no room for another RFID object");
    const key = newKey(kind, j);
    const o = { h, kind, key, meta: {} };
    objs.set(key, o); byHandle.set(h, o);
    return o;
  }
  function apply(o, j) {
    const m = o.meta;
    if (j.name !== undefined) m.name = String(j.name);
    if (j.leaveAfterBlocks !== undefined || j.leaveAfterSamples !== undefined) {
      m.leaveAfterBlocks = j.leaveAfterBlocks ?? m.leaveAfterBlocks ?? 0; m.leaveAfterSamples = j.leaveAfterSamples ?? m.leaveAfterSamples ?? 0;
      call("rfid_obj_leave_after", o.h, m.leaveAfterBlocks, m.leaveAfterSamples);
    }
    if (o.kind === "card") {
      if (j.id !== undefined) m.id = formatId(j.id);
      if (j.rf !== undefined) m.rf = j.rf;
      m.id ??= "01:02:03:04:05"; m.rf ??= 64; m.name ??= "Fob 1";
      if (!withBytes(parseId(m.id), (p) => call("rfid_card_set", o.h, p, m.rf))) throw new Error("bad card (rf must be 16, 32 or 64)");
    } else if (o.kind === "tag") {
      const cur = tagBlocks(o.h);
      let blocks = cur.blocks, flags = cur.flags;
      if (j.id !== undefined) blocks = j.id === null ? [T5577_BLANK_CONFIG, 0, 0, 0, 0, 0, 0, 0] : blocksForId(j.id);
      if (j.blocks !== undefined) { if (j.blocks.length !== 8) throw new Error("a T5577 has 8 blocks"); blocks = j.blocks.map((x) => x >>> 0); }
      if (j.writeProtected !== undefined) flags = (flags & ~1) | (j.writeProtected ? 1 : 0);
      if (j.needBoost !== undefined) flags = (flags & ~2) | (j.needBoost ? 2 : 0);
      if (j.locks !== undefined) flags = (flags & 0xff) | ((j.locks & 255) << 8);
      const t = new Uint32Array([...blocks, flags >>> 0]);
      withBytes(new Uint8Array(t.buffer), (p) => call("rfid_t5577_set", o.h, p));
      m.name ??= "T5577";
    } else {
      if (j.expectedId !== undefined) m.expectedId = formatId(j.expectedId);
      if (j.fieldHz !== undefined) m.fieldHz = j.fieldHz;
      if (j.fieldOn !== undefined) m.fieldOn = !!j.fieldOn;
      if (j.delayMs !== undefined) m.delayMs = j.delayMs;
      m.expectedId ??= "01:02:03:04:05"; m.fieldHz ??= 125000; m.fieldOn ??= true; m.delayMs ??= 50; m.name ??= "Door reader";
      withBytes(parseId(m.expectedId), (p) => call("rfid_reader_set", o.h, p, m.fieldHz, m.fieldOn ? 1 : 0, m.delayMs));
    }
  }
  function tagBlocks(h) {
    return withBuf(36, (p, out) => {
      call("rfid_t5577_get", h, p);
      const t = u32s(out());
      return { blocks: Array.from(t.subarray(0, 8)), flags: t[8] };
    });
  }
  function snapshot(o) {
    const s = { key: o.key, kind: o.kind, ...o.meta, near: !!call("rfid_obj_is_near", o.h) };
    if (o.kind === "tag") {
      const t = tagBlocks(o.h);
      s.blocks = t.blocks; s.writeProtected = !!(t.flags & 1); s.needBoost = !!(t.flags & 2); s.locks = (t.flags >>> 8) & 255;
      s.id = withBuf(5, (p, out) => (call("rfid_obj_id", o.h, p) ? formatId(out()) : null));   // what it reads back as
    } else if (o.kind === "reader") {
      Object.assign(s, withBuf(16, (p, out1) => withBuf(5, (q, out2) => {
        call("rfid_reader_get", o.h, p, q);
        const r = u32s(out1());
        return { seen: { visible: !!r[0], count: r[1], match: !!r[2], id: r[3] ? formatId(out2()) : null } };
      })));
    }
    return s;
  }

  function drain() {
    const out = [];
    call("rfid_poll");
    for (;;) {
      const got = withBuf(24, (p, rd) => {
        if (!call("rfid_ev_pop", p)) return null;
        const b = rd(), dv = new DataView(b.buffer, b.byteOffset, 24);
        return { seq: dv.getUint32(0, true), type: dv.getUint32(4, true), obj: dv.getUint32(8, true), val: dv.getUint32(12, true), id: b.slice(16, 21), flag: b[21], aux: dv.getUint16(22, true) };
      });
      if (!got) break;
      const o = byHandle.get(got.obj), key = o?.key ?? null, idStr = formatId(got.id);
      let ev = null;
      switch (EV[got.type]) {
        case "carrier": ev = ["carrier", { on: !!got.flag, hz: got.val }]; break;
        case "boost": ev = ["boost", { on: !!got.flag }]; break;
        case "card-read": ev = ["card-read", { key, id: idStr, rf: got.aux }]; break;
        case "block-written": ev = ["block-written", { key, block: got.aux, data: got.val, locked: !!got.flag }]; break;
        case "tag-id": if (got.aux === 1 && got.flag) ev = ["tag-written", { key, id: idStr }]; break;
        case "emulation": ev = ["emulation", { active: !!(got.flag & 1), decodes: !!(got.flag & 2), id: idStr, external: !!got.aux, clockHz: got.val }]; break;
        case "reader-saw": ev = ["reader-saw", { key, visible: !!got.aux, id: idStr, match: !!got.flag, count: got.val }]; break;
        case "field-measured": ev = ["field-measured", { hz: got.val }]; break;
        case "object-left": ev = ["object-left", { key, why: got.aux === 1 ? "blocks-programmed" : "samples-delivered" }]; break;
        case "write-rejected": ev = ["write-rejected", { key, reason: REJECT[got.aux] ?? "unknown", code: got.aux }]; break;
      }
      if (ev) { out.push({ type: ev[0], ...ev[1] }); ctx.emit(ev[0], ev[1]); }
    }
    return out;
  }
  ctx.onTick(drain);

  const state = () => withBuf(48, (p, out1) => withBuf(5, (q, out2) => { call("rfid_state", p, q); return { s: u32s(out1()), id: out2() }; }));

  return {
    createCard(j = {}) { const o = make("card", j); apply(o, j); return snapshot(o); },
    createTag(j = {}) { const o = make("tag", j); apply(o, j); return snapshot(o); },
    createReader(j = {}) { const o = make("reader", j); apply(o, j); return snapshot(o); },
    update(key, patch) { const o = need(key); apply(o, patch); return snapshot(o); },
    remove(key) { const o = need(key); call("rfid_obj_remove", o.h); objs.delete(key); byHandle.delete(o.h); },
    bringNear(key) { call("rfid_obj_near", need(key).h, 1); },
    takeAway(key) { call("rfid_obj_near", need(key).h, 0); },
    isNear(key) { return !!call("rfid_obj_is_near", need(key).h); },
    get: (key) => snapshot(need(key)),
    list: () => [...objs.values()].map(snapshot),
    carrier() {
      const { s } = state();
      return { on: !!(s[0] & 1), boost: !!(s[0] & 2), adcRunning: !!(s[0] & 4), pullHigh: !!(s[0] & 16), hz: s[1], gaps: s[5], programs: s[6], rejects: s[7] };
    },
    emulation() {
      const { s, id } = state();
      return { active: !!(s[0] & 8), decodes: !!(s[0] & 32), id: s[0] & 32 ? formatId(id) : null, external: !!s[10], clockHz: s[2], periodsPerBit: s[4] };
    },
    setFault(f = {}) { call("rfid_fault_set", (f.adcDead ? 1 : 0) | (f.noCarrier ? 2 : 0)); },
    poll: drain,
    reset() { call("rfid_world_reset"); objs.clear(); byHandle.clear(); },
  };
}
