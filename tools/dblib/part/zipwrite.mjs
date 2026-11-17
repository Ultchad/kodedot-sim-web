// SPDX-License-Identifier: GPL-3.0-or-later
// A small ZIP writer (stored or deflated entries, UTF-8 names, fixed timestamp so builds are reproducible).
import { deflateRawSync, crc32 } from "node:zlib";

/** @param {[string, Uint8Array][]} files @returns {Uint8Array} */
export function writeZip(files) {
  const chunks = [], central = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1;      // 2026-01-01 00:00
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8"), raw = Buffer.from(data);
    const def = deflateRawSync(raw, { level: 9 }), useDef = def.length < raw.length;
    const body = useDef ? def : raw, crc = crc32(raw) >>> 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(useDef ? 8 : 0, 8);
    h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(nameBytes.length, 26); h.writeUInt16LE(0, 28);
    chunks.push(h, nameBytes, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(useDef ? 8 : 0, 10);
    c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(raw.length, 24);
    c.writeUInt16LE(nameBytes.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, nameBytes);
    offset += h.length + nameBytes.length + body.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...chunks, ...central, end]));
}
