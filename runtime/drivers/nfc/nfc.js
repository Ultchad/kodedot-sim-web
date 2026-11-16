// dotbench NFC glue: virtual NFC tags, cards and readers on the bench.
//
// The page API is the object returned by the default export (`device.area("nfc")`); the pure helpers
// (NDEF encoding/decoding and the memory-image builders) are also named exports, usable without a device.
//
// Bench objects live in C (persistent region "nfc"), not here: they survive a restart of the device, and
// this glue keeps no state about them except what it needs to turn counters into events.
//
//   const nfc = device.area("nfc");
//   const tag  = nfc.tag({ uid: "04:A2:3B:91:5C:6D:80", memory: "ntag213", text: "hello", lang: "en" });
//   const card = nfc.card({ type: "mifare1k", uid: "DE:AD:BE:EF", uri: "https://kode.diy" });
//   const rdr  = nfc.reader({ field: 0x90 });
//   tag.near(); tag.away();                  // bring the object to the antenna / take it away
//   tag.update({ uri: "https://example.com" });   // change the content while near
//   tag.content();                           // { records:[{type:"uri",uri:...}], text?, uri?, ... } as stored now
//   tag.setLocked(true);                     // read-only (CC and lock bytes)
//   tag.dropAfter(1);                        // it leaves the field by itself after 1 more exchange (tearing)
//   rdr.seen();  rdr.read(0);                // what the reader saw of the emulated card; read 4 pages by hand
//   nfc.state();                             // chip, field, discovery, activated object, emulation window
//   nfc.setChipFitted(false);                // no Antenna PCB at the next boot (kept across restarts)
//
// Events (page side: dev.on("area:nfc:<type>", cb); payloads below):
//   field {on, cert}                     the Dot's field went up / down
//   created {id,kind} / removed {id}     an object was made / destroyed
//   near {id, near}                      an object was brought near / taken away
//   activated {id}                       the device selected the object (anticollision done)
//   read {id, reads}                     the device read from the object (coalesced per poll)
//   written {id, writes, content, memory}  the device wrote to the object, with the content as stored now
//   lost {id}                            an exchange found the activated object gone
//   dropped {id}                         the object left by itself (dropAfter)
//   emulation {started, uidLen?, sak?, reads?}  the Dot's emulation window opened / closed
//   reader-saw {id, sessions, seen}      a reader object met the emulated card / read pages of it

export const KIND = { T2T: 1, T4T: 2, MIFARE: 3, OTHER: 4, READER: 5 };
const FLAG = { LOCKED: 1, NOAPP: 2, MUTE: 4, AUTOREAD: 8 };
const EV = { FIELD_ON: 1, FIELD_OFF: 2, ACTIVATED: 3, NEAR: 4, DROPPED: 5, EMU_STARTED: 6, EMU_STOPPED: 7, READER_SEEN: 8, LOST: 9, REMOVED: 10, CREATED: 11 };
const MEM_BYTES = 4096;

// ------------------------------------------------------------------ NDEF (JS only builds / reads)

const URI_PREFIX = ["", "http://www.", "https://www.", "http://", "https://", "tel:", "mailto:", "ftp://anonymous:anonymous@", "ftp://ftp.",
  "ftps://", "sftp://", "smb://", "nfs://", "ftp://", "dav://", "news:", "telnet://", "imap:", "rtsp://", "urn:", "pop:", "sip:", "sips:",
  "tftp:", "btspp://", "btl2cap://", "btgoep://", "tcpobex://", "irdaobex://", "file://", "urn:epc:id:", "urn:epc:tag:", "urn:epc:pat:",
  "urn:epc:raw:", "urn:epc:", "urn:nfc:"];
const utf8 = new TextEncoder();
const unutf8 = new TextDecoder("utf-8");
const bytesOf = (v) => (typeof v === "string" ? utf8.encode(v) : v instanceof Uint8Array ? v : Uint8Array.from(v ?? []));

/** Encode one record: {type:"text",text,lang?} | {type:"uri",uri} | {type:"mime",mime,data} | {type:"raw",tnf,recordType,payload}. */
function encodeRecord(r, mb, me) {
  let tnf = 1, type, payload;
  if (r.type === "text") {
    const lang = utf8.encode(r.lang ?? "en");
    if (lang.length > 63) throw new Error("language code too long");
    payload = Uint8Array.from([lang.length, ...lang, ...utf8.encode(r.text ?? "")]);
    type = utf8.encode("T");
  } else if (r.type === "uri") {
    const uri = String(r.uri ?? "");
    let best = 0;
    for (let i = 1; i < URI_PREFIX.length; i++) if (uri.startsWith(URI_PREFIX[i]) && URI_PREFIX[i].length > URI_PREFIX[best].length) best = i;
    payload = Uint8Array.from([best, ...utf8.encode(uri.slice(URI_PREFIX[best].length))]);
    type = utf8.encode("U");
  } else if (r.type === "mime") {
    tnf = 2; type = utf8.encode(r.mime); payload = bytesOf(r.data);
  } else if (r.type === "raw") {
    tnf = r.tnf ?? 5; type = bytesOf(r.recordType); payload = bytesOf(r.payload);
  } else throw new Error("unknown record type " + r.type);
  const sr = payload.length < 256;
  const hdr = (mb ? 0x80 : 0) | (me ? 0x40 : 0) | (sr ? 0x10 : 0) | tnf;
  const len = sr ? [payload.length] : [payload.length >>> 24, (payload.length >>> 16) & 255, (payload.length >>> 8) & 255, payload.length & 255];
  return [hdr, type.length, ...len, ...type, ...payload];
}

/** An NDEF message (no TLV) from records. */
export function encodeNdef(records) {
  const out = [];
  records.forEach((r, i) => out.push(...encodeRecord(r, i === 0, i === records.length - 1)));
  return Uint8Array.from(out);
}

/** Wrap a message in the Type-2 / Mifare TLV: 03 len msg FE (long length form above 254 bytes). */
export function wrapTlv(msg) {
  const len = msg.length < 255 ? [msg.length] : [0xff, msg.length >> 8, msg.length & 255];
  return Uint8Array.from([0x03, ...len, ...msg, 0xfe]);
}

/** Find the NDEF message inside a TLV area (null when there is none). */
export function findTlv(area) {
  let i = 0;
  while (i < area.length) {
    const t = area[i];
    if (t === 0x00) { i++; continue; }
    if (t === 0xfe) return null;
    let len, hdr;
    if (area[i + 1] === 0xff) { len = (area[i + 2] << 8) | area[i + 3]; hdr = 4; } else { len = area[i + 1]; hdr = 2; }
    if (i + hdr > area.length) return null;
    if (t === 0x03) return area.subarray(i + hdr, Math.min(area.length, i + hdr + len));
    i += hdr + len;
  }
  return null;
}

/** Decode an NDEF message into records. Unknown records come back as {type:"unknown", tnf, recordType, payload}. */
export function decodeNdef(msg) {
  const recs = [];
  let i = 0;
  while (i < msg.length) {
    const h = msg[i++];
    const sr = !!(h & 0x10), il = !!(h & 0x08), tnf = h & 7;
    const tl = msg[i++];
    let pl;
    if (sr) pl = msg[i++]; else { pl = ((msg[i] << 24) | (msg[i + 1] << 16) | (msg[i + 2] << 8) | msg[i + 3]) >>> 0; i += 4; }
    const il_len = il ? msg[i++] : 0;
    const type = msg.subarray(i, i + tl); i += tl;
    i += il_len;
    const pay = msg.subarray(i, i + pl); i += pl;
    const t = unutf8.decode(type);
    if (tnf === 1 && t === "T" && pay.length) {
      const ll = pay[0] & 0x3f;
      const utf16 = !!(pay[0] & 0x80);
      recs.push({ type: "text", lang: unutf8.decode(pay.subarray(1, 1 + ll)), text: new TextDecoder(utf16 ? "utf-16be" : "utf-8").decode(pay.subarray(1 + ll)) });
    } else if (tnf === 1 && t === "U" && pay.length) {
      recs.push({ type: "uri", uri: (URI_PREFIX[pay[0]] ?? "") + unutf8.decode(pay.subarray(1)) });
    } else if (tnf === 2) {
      recs.push({ type: "mime", mime: t, data: Uint8Array.from(pay) });
    } else recs.push({ type: "unknown", tnf, recordType: Uint8Array.from(type), payload: Uint8Array.from(pay) });
    if (h & 0x40) break;
  }
  return recs;
}

/** Records from friendly spec fields: `records`, or `text` (+`lang`) and/or `uri`. */
function recordsOf(spec) {
  if (spec.records) return spec.records;
  const r = [];
  if (spec.text !== undefined) r.push({ type: "text", text: spec.text, lang: spec.lang });
  if (spec.uri !== undefined) r.push({ type: "uri", uri: spec.uri });
  return r;
}
const summarise = (records) => {
  const out = { records };
  const t = records.find((r) => r.type === "text"), u = records.find((r) => r.type === "uri");
  if (t) { out.text = t.text; out.lang = t.lang; }
  if (u) out.uri = u.uri;
  return out;
};

// ------------------------------------------------------------------ memory images

export const parseHex = (s) => {
  if (typeof s !== "string") return Uint8Array.from(s);
  // "04:A2-3B 91" (separated bytes) or "04A23B91" (contiguous pairs)
  const parts = s.split(/[:\s-]+/).filter(Boolean).flatMap((x) => (x.length > 2 ? x.match(/.{1,2}/g) : [x]));
  return Uint8Array.from(parts.map((x) => parseInt(x, 16)));
};
export const hex = (b, sep = ":") => Array.from(b, (x) => x.toString(16).padStart(2, "0").toUpperCase()).join(sep);

const T2T_SIZES = { ultralight: 64, ntag213: 180, ntag215: 540, ntag216: 924 };

/** Type-2 image: UID pages + BCCs, capability container, NDEF TLV. `formatted:false` leaves the CC empty. */
export function t2tImage(spec) {
  const total = typeof spec.memory === "number" ? spec.memory : T2T_SIZES[spec.memory ?? "ntag213"];
  if (!total || total % 4 || total < 64 || total > MEM_BYTES) throw new Error("bad tag memory size " + spec.memory);
  const uid = parseHex(spec.uid ?? "04:11:22:33:44:55:66");
  if (uid.length !== 7) throw new Error("a Type-2 tag has a 7 byte UID");
  const mem = new Uint8Array(total);
  mem.set(uid.subarray(0, 3), 0); mem[3] = 0x88 ^ uid[0] ^ uid[1] ^ uid[2];
  mem.set(uid.subarray(3, 7), 4); mem[8] = uid[3] ^ uid[4] ^ uid[5] ^ uid[6]; mem[9] = 0x48;
  const dataBytes = total - 16 - (total >= 180 ? 20 : 0);
  const lock = spec.locked ? (spec.lockMode ?? "both") : "none";
  if (lock === "chip" || lock === "both") { mem[10] = 0xff; mem[11] = 0xff; }
  if (spec.formatted !== false) {
    mem.set([0xe1, 0x10, Math.min(255, dataBytes >> 3), lock === "cc" || lock === "both" ? 0x0f : 0x00], 12);
    const recs = recordsOf(spec);
    if (recs.length) {
      const tlv = wrapTlv(encodeNdef(recs));
      if (tlv.length > dataBytes) throw new Error(`message (${tlv.length} bytes) does not fit the tag (${dataBytes})`);
      mem.set(tlv, 16);
    } else mem.set([0x03, 0x00, 0xfe], 16);
  }
  return mem;
}

const MFC_BLOCKS = { mini: 20, "1k": 64, "4k": 256 };
const mfcSectorFirst = (s) => (s < 32 ? s * 4 : 128 + (s - 32) * 16);
const mfcSectorBlocks = (s) => (s < 32 ? 4 : 16);
function madCrc(bytes) {
  let crc = 0xc7;
  for (const b of bytes) { crc ^= b; for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x1d) & 255 : (crc << 1) & 255; }
  return crc;
}

/** Mifare Classic image. Keys default to the NFC Forum NDEF layout (MAD key A0A1A2A3A4A5, data key D3F7D3F7D3F7);
 *  `blank:true` gives a factory card (all keys FFFFFFFFFFFF, no MAD, no message); `keys:{a,b}` sets every sector's
 *  keys (use a key the SDK does not know to make a card kodeOS cannot open). */
export function mifareImage(spec) {
  const size = spec.size ?? "1k";
  const blocks = MFC_BLOCKS[size];
  if (!blocks) throw new Error("bad Mifare size " + size);
  const uid = parseHex(spec.uid ?? "DE:AD:BE:EF");
  if (uid.length !== 4) throw new Error("this model gives a Mifare Classic a 4 byte UID");
  const mem = new Uint8Array(blocks * 16);
  mem.set(uid, 0); mem[4] = uid[0] ^ uid[1] ^ uid[2] ^ uid[3]; mem[5] = size === "4k" ? 0x18 : size === "mini" ? 0x09 : 0x08;
  mem.set(size === "4k" ? [0x02, 0x00] : [0x04, 0x00], 6);
  const sectors = size === "4k" ? 40 : size === "mini" ? 5 : 16;
  const blank = !!spec.blank;
  const ka = spec.keys?.a ? parseHex(spec.keys.a) : null, kb = spec.keys?.b ? parseHex(spec.keys.b) : null;
  const FF = Uint8Array.from([255, 255, 255, 255, 255, 255]);
  for (let s = 0; s < sectors; s++) {
    const t = (mfcSectorFirst(s) + mfcSectorBlocks(s) - 1) * 16;
    const a = ka ?? (blank ? FF : s === 0 ? parseHex("A0A1A2A3A4A5") : parseHex("D3F7D3F7D3F7"));
    const b = kb ?? FF;
    const acc = blank ? [0xff, 0x07, 0x80, 0x69] : s === 0 ? [0x78, 0x77, 0x88, 0xc1] : [0x7f, 0x07, 0x88, 0x40];
    mem.set(a, t); mem.set(acc, t + 6); mem.set(b, t + 10);
  }
  if (!blank) {
    const recs = recordsOf(spec);
    // MAD1: block 1 = [crc, info, AID s1..s7], block 2 = AIDs s8..s15; sectors 1 and 2 carry NDEF (0x03E1).
    mem[16 + 1] = 0x01;
    for (const s of [1, 2]) { mem[16 + s * 2] = 0xe1; mem[16 + s * 2 + 1] = 0x03; }
    mem[16] = madCrc(mem.subarray(17, 48));
    if (recs.length) writeMifareArea(mem, wrapTlv(encodeNdef(recs)));
    else writeMifareArea(mem, Uint8Array.from([0x03, 0x00, 0xfe]));
  }
  return mem;
}
const MFC_DATA_BLOCKS = [4, 5, 6, 8, 9, 10];   // the 96 bytes of sectors 1 and 2 kodeOS reads and writes
function writeMifareArea(mem, tlv) {
  if (tlv.length > 96) throw new Error(`message (${tlv.length} bytes) does not fit the 96 bytes of the NDEF sectors`);
  MFC_DATA_BLOCKS.forEach((b, i) => { mem.fill(0, b * 16, b * 16 + 16); mem.set(tlv.subarray(i * 16, i * 16 + 16), b * 16); });
}
const readMifareArea = (mem) => { const a = new Uint8Array(96); MFC_DATA_BLOCKS.forEach((b, i) => a.set(mem.subarray(b * 16, b * 16 + 16), i * 16)); return a; };

/** Type-4 NDEF file: 2 byte NLEN then the message, padded to `fileSize` bytes (NLEN included). */
export function t4File(spec) {
  const size = spec.fileSize ?? 512;
  const f = new Uint8Array(size);
  const recs = recordsOf(spec);
  if (recs.length) {
    const msg = encodeNdef(recs);
    if (msg.length + 2 > size) throw new Error(`message (${msg.length} bytes) does not fit the file (${size - 2})`);
    f[0] = msg.length >> 8; f[1] = msg.length & 255; f.set(msg, 2);
  }
  return f;
}

/** Decode what a memory holds. kind: KIND.*; returns {records, text?, uri?, valid, formatted}. */
export function decodeMemory(kind, mem) {
  if (kind === KIND.T2T) {
    const formatted = mem.length > 15 && mem[12] === 0xe1;
    const msg = formatted ? findTlv(mem.subarray(16)) : null;
    return { formatted, valid: !!msg, ...summarise(msg ? decodeNdef(msg) : []), readOnly: formatted && (mem[15] & 0x0f) !== 0 };
  }
  if (kind === KIND.MIFARE) {
    const msg = mem.length >= 176 ? findTlv(readMifareArea(mem)) : null;
    return { formatted: mem.length >= 176 && mem[16 + 2] === 0xe1 && mem[16 + 3] === 0x03, valid: !!msg, ...summarise(msg ? decodeNdef(msg) : []) };
  }
  if (kind === KIND.T4T) {
    const n = (mem[0] << 8) | mem[1];
    const msg = n ? mem.subarray(2, 2 + n) : null;
    return { formatted: true, valid: !!msg, ...summarise(msg ? decodeNdef(msg) : []) };
  }
  return { formatted: false, valid: false, ...summarise([]) };
}

// ------------------------------------------------------------------ the glue

const CARD_TYPES = { "iso-dep": "t4t", type4: "t4t", t4t: "t4t", mifare1k: "1k", "mifare-classic": "1k", mifare4k: "4k", mifaremini: "mini" };

export default function (ctx) {
  const call = (fn, ...a) => ctx.call(fn, ...a);
  const withBytes = (bytes, fn) => {
    const p = ctx.alloc(Math.max(bytes.length, 4));
    try { ctx.heap().set(bytes, p); return fn(p); } finally { ctx.free(p); }
  };
  const withOut = (n, fn) => {
    const p = ctx.alloc(n);
    try { const r = fn(p); return [r, ctx.heap().slice(p, p + n)]; } finally { ctx.free(p); }
  };
  const words = (n, fn) => {
    const [r, b] = withOut(n * 4, fn);
    return r < 0 ? null : new Uint32Array(b.buffer, b.byteOffset, n);
  };
  const info = (id) => words(16, (p) => call("nfc_obj_info", id, p));
  const blob = (id, which, off, len) => { const [r, b] = withOut(Math.max(len, 4), (p) => call("nfc_obj_read_blob", id, which, p, off, len)); return r < 0 ? null : b.slice(0, r); };
  const memory = (id) => { const w = info(id); return w ? blob(id, 0, 0, w[6]) : null; };
  const setMemory = (id, bytes, offset = 0) => withBytes(bytes, (p) => call("nfc_obj_set_memory", id, p, bytes.length, offset));
  const setIdentity = (id, uid, atqa, sak) => withBytes(uid, (p) => call("nfc_obj_set_identity", id, p, uid.length, atqa, sak));

  const handles = new Map();
  const handleFor = (id) => {
    if (handles.has(id)) return handles.get(id);
    const h = makeHandle(id);
    handles.set(id, h);
    return h;
  };

  function makeHandle(id) {
    const h = {
      id,
      get kind() { return info(id)?.[0] ?? 0; },
      near: () => { call("nfc_obj_near", id, 1); return h; },
      away: () => { call("nfc_obj_near", id, 0); return h; },
      remove: () => { const r = call("nfc_obj_destroy", id); handles.delete(id); return r === 0; },
      /** Raw state of the object (null when it no longer exists). */
      info() {
        const w = info(id);
        if (!w) return null;
        const o = { id, kind: w[0], near: !!w[1], locked: !!(w[2] & FLAG.LOCKED), uid: hex(blob(id, 1, 0, w[3])), atqa: w[4], sak: w[5],
          memorySize: w[6], writes: w[7], reads: w[8], modSeq: w[9], dropLeft: w[14] === 0xffffffff ? null : w[14] };
        if (w[0] === KIND.READER) Object.assign(o, { sessions: w[10], field: w[15] & 255, modulation: w[15] >> 8 });
        return o;
      },
      /** The raw memory (a copy). */
      memory: () => memory(id),
      /** Decode the NDEF content as it is stored now. */
      content() { const w = info(id); return w ? decodeMemory(w[0], memory(id)) : null; },
      /** Replace the NDEF content (text/uri/records) keeping identity, size and lock state. Works while near. */
      update(patch) {
        const w = info(id);
        if (!w) throw new Error("no such object " + id);
        const mem = memory(id);
        if (patch.uid !== undefined) {
          const uid = parseHex(patch.uid);
          if (w[0] === KIND.T2T) {
            if (uid.length !== 7) throw new Error("a Type-2 tag has a 7 byte UID");
            mem.set(uid.subarray(0, 3), 0); mem[3] = 0x88 ^ uid[0] ^ uid[1] ^ uid[2];
            mem.set(uid.subarray(3, 7), 4); mem[8] = uid[3] ^ uid[4] ^ uid[5] ^ uid[6];
          } else if (w[0] === KIND.MIFARE) {
            mem.set(uid, 0); mem[4] = uid[0] ^ uid[1] ^ uid[2] ^ uid[3];
          }
          setIdentity(id, uid, w[4], w[5]);
        }
        if (patch.text !== undefined || patch.uri !== undefined || patch.records !== undefined) {
          const recs = recordsOf(patch);
          const msg = recs.length ? encodeNdef(recs) : new Uint8Array(0);
          if (w[0] === KIND.T2T) {
            const area = mem.length - 16 - (mem.length >= 180 ? 20 : 0);
            const tlv = recs.length ? wrapTlv(msg) : Uint8Array.from([0x03, 0x00, 0xfe]);
            if (mem[12] !== 0xe1) mem.set([0xe1, 0x10, Math.min(255, area >> 3), 0x00], 12);
            if (tlv.length > area) throw new Error(`message (${tlv.length} bytes) does not fit the tag (${area})`);
            mem.fill(0, 16, 16 + area); mem.set(tlv, 16);
          } else if (w[0] === KIND.MIFARE) {
            writeMifareArea(mem, recs.length ? wrapTlv(msg) : Uint8Array.from([0x03, 0x00, 0xfe]));
          } else if (w[0] === KIND.T4T) {
            if (msg.length + 2 > mem.length) throw new Error(`message (${msg.length} bytes) does not fit the file (${mem.length - 2})`);
            mem.fill(0); mem[0] = msg.length >> 8; mem[1] = msg.length & 255; mem.set(msg, 2);
          } else throw new Error("this object has no NDEF content");
        }
        if (patch.memory !== undefined) mem.set(bytesOf(patch.memory).subarray(0, mem.length));
        setMemory(id, mem);
        if (patch.locked !== undefined) h.setLocked(patch.locked, patch.lockMode);
        return h;
      },
      /** Read-only (true) or writable (false). Type-2: capability container and lock bytes (lockMode: "cc" | "chip" | "both"). */
      setLocked(locked, lockMode = "both") {
        const w = info(id);
        let flags = w[2];
        const mem = memory(id);
        if (w[0] === KIND.T2T) {
          const cc = lockMode === "cc" || lockMode === "both", chip = lockMode === "chip" || lockMode === "both";
          if (mem[12] === 0xe1) mem[15] = locked && cc ? 0x0f : 0x00;
          mem[10] = mem[11] = locked && chip ? 0xff : 0x00;
          flags = locked && chip ? flags | FLAG.LOCKED : flags & ~FLAG.LOCKED;
          setMemory(id, mem);
        } else flags = locked ? flags | FLAG.LOCKED : flags & ~FLAG.LOCKED;
        call("nfc_obj_set_flags", id, flags);
        return h;
      },
      /** Type-4 only: the NDEF application is missing (SELECT answers 6A82). */
      setNoApp(on = true) { const w = info(id); call("nfc_obj_set_flags", id, on ? w[2] | FLAG.NOAPP : w[2] & ~FLAG.NOAPP); return h; },
      /** A dead tag: it never answers, so it never activates. */
      setMute(on = true) { const w = info(id); call("nfc_obj_set_flags", id, on ? w[2] | FLAG.MUTE : w[2] & ~FLAG.MUTE); return h; },
      /** The object leaves the field by itself after n more exchanges (n < 0 cancels). n = 0: at the very next one. */
      dropAfter(n) { call("nfc_obj_set_param", id, 1, n); return h; },
    };
    // reader-only
    h.seen = () => {
      const w = info(id);
      if (!w || w[0] !== KIND.READER) return null;
      const valid = blob(id, 3, 0, 128);
      const pages = []; for (let p = 0; p < 1024; p++) if (valid[p >> 3] & (1 << (p & 7))) pages.push(p);
      return { sessions: w[10], reads: w[8], uid: w[11] ? hex(blob(id, 2, 0, w[11])) : null, atqa: w[12], sak: w[13], pages, memory: w[6] ? memory(id) : new Uint8Array(0),
        ...(w[6] ? decodeMemory(KIND.T2T, memory(id)) : { records: [] }) };
    };
    h.read = (block) => call("nfc_reader_read", id, block);
    h.setField = (amp, mod) => { call("nfc_obj_set_param", id, 2, amp); if (mod !== undefined) call("nfc_obj_set_param", id, 3, mod); return h; };
    h.setAutoRead = (on) => { const w = info(id); call("nfc_obj_set_flags", id, on ? w[2] | FLAG.AUTOREAD : w[2] & ~FLAG.AUTOREAD); return h; };
    return h;
  }

  function create(kind, uid, atqa, sak, mem, flags) {
    const id = call("nfc_obj_create", kind);
    if (id < 0) throw new Error("the bench has no free slot for another NFC object");
    setIdentity(id, uid, atqa, sak);
    if (mem) { call("nfc_obj_set_mem_len", id, 0); setMemory(id, mem); }
    if (flags) call("nfc_obj_set_flags", id, flags);
    return handleFor(id);
  }

  const api = {
    KIND, ndef: { encode: encodeNdef, decode: decodeNdef, wrapTlv, findTlv, decodeMemory },

    /** A Type-2 tag (NTAG style). spec: {uid, memory:"ntag213"|"ntag215"|"ntag216"|"ultralight"|bytes, text, lang, uri, records,
     *  locked, lockMode, formatted:false, near:true}. */
    tag(spec = {}) {
      const mem = t2tImage(spec);
      const uid = parseHex(spec.uid ?? "04:11:22:33:44:55:66");
      const h = create(KIND.T2T, uid, spec.atqa ?? 0x0044, spec.sak ?? 0x00, mem, spec.locked && (spec.lockMode ?? "both") !== "cc" ? FLAG.LOCKED : 0);
      if (spec.mute) h.setMute();
      if (spec.near) h.near();
      return h;
    },

    /** A card. spec.type: "iso-dep" (Type-4 NDEF file) | "mifare1k" | "mifare4k" | "mifaremini" | "unsupported".
     *  iso-dep: {uid (4/7/10), fileSize, text/uri/records, locked, noApp}; mifare: {uid (4), blank, keys:{a,b}, text/uri, locked};
     *  unsupported: {uid, sak (default 0x40: NFC-DEP), atqa}. */
    card(spec = {}) {
      const t = spec.type ?? "iso-dep";
      let h;
      if (t === "unsupported" || t === "other") {
        h = create(KIND.OTHER, parseHex(spec.uid ?? "08:11:22:33"), spec.atqa ?? 0x0004, spec.sak ?? 0x40, null, 0);
      } else {
        const m = CARD_TYPES[t];
        if (!m) throw new Error("unknown card type " + t);
        if (m === "t4t") {
          const file = t4File(spec);
          const uid = parseHex(spec.uid ?? "04:AA:BB:CC:DD:EE:FF");
          h = create(KIND.T4T, uid, spec.atqa ?? 0x0344, spec.sak ?? 0x20, file, (spec.locked ? FLAG.LOCKED : 0) | (spec.noApp ? FLAG.NOAPP : 0));
        } else {
          const mem = mifareImage({ ...spec, size: m });
          const uid = mem.slice(0, 4);
          h = create(KIND.MIFARE, uid, spec.atqa ?? (m === "4k" ? 0x0002 : 0x0004), spec.sak ?? (m === "4k" ? 0x18 : m === "mini" ? 0x09 : 0x08), mem, spec.locked ? FLAG.LOCKED : 0);
        }
      }
      if (spec.mute) h.setMute();
      if (spec.near) h.near();
      return h;
    },

    /** A reader for when the Dot emulates a card. spec: {field: amplitude byte, modulation, autoRead (default true), near}. */
    reader(spec = {}) {
      const id = call("nfc_obj_create", KIND.READER);
      if (id < 0) throw new Error("the bench has no free slot for another NFC object");
      const h = handleFor(id);
      if (spec.field !== undefined) call("nfc_obj_set_param", id, 2, spec.field);
      if (spec.modulation !== undefined) call("nfc_obj_set_param", id, 3, spec.modulation);
      if (spec.autoRead === false) h.setAutoRead(false);
      if (spec.near) h.near();
      return h;
    },

    /** Handle for an object id (also after a restart). */
    get: (id) => (info(id) ? handleFor(id) : null),
    /** Every object on the bench. */
    objects() { const out = []; for (let id = 1; id <= 6; id++) if (info(id)) out.push(handleFor(id)); return out; },
    /** The device side: chip, field, discovery, activation and emulation. */
    state() {
      const w = words(16, (p) => call("nfc_state", p));
      return { chipFitted: !!w[0], chipPresent: !!w[1], field: !!w[2], discovering: !!w[3], activated: w[4] || null, activatedLost: !!w[5],
        emulating: !!w[6], emulationStopping: !!w[7], listening: !!w[8], tagsActivated: w[9], errors: w[10],
        emulation: { sessions: w[11], reads: w[12], field: !!w[13], selected: !!w[14] }, certCarrier: !!w[15] };
    },
    /** Antenna PCB fitted (default) or not. Read by the driver at boot: restart the device for it to take effect. */
    setChipFitted: (fitted) => call("nfc_chip_fitted", fitted ? 1 : 0),
    /** Remove every object and refit the chip. */
    reset() { handles.clear(); return call("nfc_reset_bench"); },

    /** Drain events and counters now (also runs every poll when the page drives the glue). */
    poll,
  };

  // ---- events ---------------------------------------------------------------------------------------------
  const last = new Map();      // id -> {reads, modSeq, pendingSeq}
  let primed = false;
  function poll() {
    for (;;) {
      const [r, b] = withOut(16, (p) => call("nfc_event_pop", p));
      if (r !== 1) break;
      const [type, id, a, bb] = new Uint32Array(b.buffer, b.byteOffset, 4);
      switch (type) {
        case EV.FIELD_ON: ctx.emit("field", { on: true, cert: a === 1 }); break;
        case EV.FIELD_OFF: ctx.emit("field", { on: false, cert: false }); break;
        case EV.ACTIVATED: ctx.emit("activated", { id }); break;
        case EV.NEAR: ctx.emit("near", { id, near: !!a }); break;
        case EV.DROPPED: ctx.emit("dropped", { id }); break;
        case EV.LOST: ctx.emit("lost", { id }); break;
        case EV.CREATED: ctx.emit("created", { id, kind: a }); break;
        case EV.REMOVED: last.delete(id); ctx.emit("removed", { id }); break;
        case EV.EMU_STARTED: ctx.emit("emulation", { started: true, uidLen: a, sak: bb }); break;
        case EV.EMU_STOPPED: ctx.emit("emulation", { started: false, reads: a }); break;
        case EV.READER_SEEN: { const h = info(id) ? handleFor(id) : null; ctx.emit("reader-saw", { id, sessions: a, seen: h?.seen() ?? null }); break; }
        default: break;
      }
    }
    // counters: what the device read / wrote since the last poll
    for (let id = 1; id <= 6; id++) {
      const w = info(id);
      if (!w) { last.delete(id); continue; }
      const prev = last.get(id) ?? { reads: w[8], modSeq: w[9], pend: w[9] };
      if (w[0] !== KIND.READER && w[8] !== prev.reads && primed) ctx.emit("read", { id, reads: w[8] });
      if (w[0] !== KIND.READER && primed) {
        // a write is reported once the sequence has been quiet for one poll (a write is several block writes)
        if (w[9] !== prev.pend) prev.pend = w[9];
        else if (prev.pend !== prev.modSeq) {
          prev.modSeq = prev.pend;
          const mem = memory(id);
          ctx.emit("written", { id, writes: w[7], content: decodeMemory(w[0], mem), memory: mem });
        }
      }
      prev.reads = w[8];
      if (!primed) { prev.modSeq = w[9]; prev.pend = w[9]; }
      last.set(id, prev);
    }
    primed = true;
  }
  poll();
  ctx.onTick(poll);
  return api;
}
