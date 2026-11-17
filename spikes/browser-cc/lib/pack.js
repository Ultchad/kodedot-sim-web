// SPDX-License-Identifier: GPL-3.0-or-later
// A trivial file pack: "DPK1", u32 count, then per file u16 nameLen, name, u32 size, bytes. unpack() returns views, no copies.
export function packFiles(map) {
  const te = new TextEncoder(), items = [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, d]) => [te.encode(n), typeof d === "string" ? te.encode(d) : d]);
  let size = 8; for (const [n, d] of items) size += 2 + n.length + 4 + d.length;
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  out.set(te.encode("DPK1"), 0); dv.setUint32(4, items.length, true);
  let p = 8;
  for (const [n, d] of items) { dv.setUint16(p, n.length, true); p += 2; out.set(n, p); p += n.length; dv.setUint32(p, d.length, true); p += 4; out.set(d, p); p += d.length; }
  return out;
}
export function unpack(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), td = new TextDecoder(), out = new Map();
  if (td.decode(bytes.subarray(0, 4)) !== "DPK1") throw new Error("not a DPK1 pack");
  const n = dv.getUint32(4, true); let p = 8;
  for (let i = 0; i < n; i++) {
    const l = dv.getUint16(p, true); p += 2; const name = td.decode(bytes.subarray(p, p + l)); p += l;
    const s = dv.getUint32(p, true); p += 4; out.set(name, bytes.subarray(p, p + s)); p += s;
  }
  return out;
}
/** flat path map -> nested yowasp tree */
export function toTree(map, tree = {}) {
  for (const [p, v] of map) { const parts = p.split("/"); let d = tree; for (const s of parts.slice(0, -1)) d = d[s] ??= {}; d[parts.at(-1)] = v; }
  return tree;
}
