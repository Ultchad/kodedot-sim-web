// Tiny PNG encoder (8-bit RGB) using zlib from Node's standard library. No dependencies.
import zlib from "node:zlib";
import fs from "node:fs";

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const t = Buffer.from(type, "ascii"), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};

/** rgba: Uint8Array width*height*4 (stride = width*4 unless given). Returns a PNG Buffer. */
export function encodePng(rgba, width, height, stride = width * 4) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    raw[o] = 0;
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * 4;
      raw[o + 1 + x * 3] = rgba[s]; raw[o + 2 + x * 3] = rgba[s + 1]; raw[o + 3 + x * 3] = rgba[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;   // 8 bit, truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function savePng(file, rgba, width, height, stride) {
  fs.writeFileSync(file, encodePng(rgba, width, height, stride));
}
