// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal ZIP writer, stored entries only, no dependencies: runs in the browser too. (build tool uses deflate via node:zlib; this is for in-page packaging.)
const T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** @param {[string, Uint8Array][]} files */
export function writeStoredZip(files) {
  const te = new TextEncoder(), chunks = [], central = []; let off = 0;
  const DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, raw0] of files) {
    const nb = te.encode(name), raw = raw0 instanceof Uint8Array ? raw0 : new Uint8Array(raw0), crc = crc32(raw);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(10, 0, true); h.setUint16(12, DATE, true);
    h.setUint32(14, crc, true); h.setUint32(18, raw.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, nb.length, true);
    chunks.push(new Uint8Array(h.buffer), nb, raw);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(14, DATE, true);
    c.setUint32(16, crc, true); c.setUint32(20, raw.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb); off += 30 + nb.length + raw.length;
  }
  const cd = central.reduce((n, b) => n + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cd, true); e.setUint32(16, off, true);
  const all = [...chunks, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((n, b) => n + b.length, 0)); let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return out;
}
