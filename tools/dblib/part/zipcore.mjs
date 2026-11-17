// SPDX-License-Identifier: GPL-3.0-or-later
// A small ZIP writer (stored or deflated entries, UTF-8 names, fixed timestamp so builds are reproducible). Pure: no node: imports and no Buffer,
// so the browser compile service uses it too. `deflate(bytes) -> bytes|null` and `crc32(bytes) -> number` come from the host (zipwrite.mjs: node:zlib).
const enc = new TextEncoder();
const concat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const rec = (n) => { const b = new Uint8Array(n); return { b, v: new DataView(b.buffer), u16(o, x) { this.v.setUint16(o, x, true); }, u32(o, x) { this.v.setUint32(o, x >>> 0, true); } }; };

/** @param {[string, Uint8Array][]} files @param {{deflate?: (b: Uint8Array) => Uint8Array, crc32: (b: Uint8Array) => number}} host @returns {Uint8Array} */
export function writeZipWith(files, { deflate, crc32 }) {
  const chunks = [], central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;      // 2026-01-01 00:00
  for (const [name, data] of files) {
    const nameBytes = enc.encode(name), raw = data instanceof Uint8Array ? data : enc.encode(String(data));
    const def = deflate ? deflate(raw) : null, useDef = !!def && def.length < raw.length;
    const body = useDef ? def : raw, crc = crc32(raw) >>> 0;
    const h = rec(30);
    h.u32(0, 0x04034b50); h.u16(4, 20); h.u16(6, 0x0800); h.u16(8, useDef ? 8 : 0);
    h.u16(10, DOS_TIME); h.u16(12, DOS_DATE); h.u32(14, crc); h.u32(18, body.length); h.u32(22, raw.length);
    h.u16(26, nameBytes.length); h.u16(28, 0);
    chunks.push(h.b, nameBytes, body);
    const c = rec(46);
    c.u32(0, 0x02014b50); c.u16(4, 20); c.u16(6, 20); c.u16(8, 0x0800); c.u16(10, useDef ? 8 : 0);
    c.u16(12, DOS_TIME); c.u16(14, DOS_DATE); c.u32(16, crc); c.u32(20, body.length); c.u32(24, raw.length);
    c.u16(28, nameBytes.length); c.u32(42, offset);
    central.push(c.b, nameBytes);
    offset += h.b.length + nameBytes.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = rec(22);
  end.u32(0, 0x06054b50); end.u16(8, files.length); end.u16(10, files.length); end.u32(12, cdSize); end.u32(16, offset);
  return concat([...chunks, ...central, end.b]);
}
