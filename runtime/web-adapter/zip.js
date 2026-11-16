// Minimal ZIP reader (stored + deflate) for .dotbench packages. No dependencies:
// DecompressionStream('deflate-raw') does the inflating (Chrome 80+, Safari 16.4+, Firefox 113+).

const u16 = (v, o) => v.getUint16(o, true);
const u32 = (v, o) => v.getUint32(o, true);

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Promise<Map<string, Uint8Array>>} entry name -> contents
 */
export async function readZip(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(view, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const count = u16(view, eocd + 10);
  let p = u32(view, eocd + 16);
  const out = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(view, p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = u16(view, p + 10);
    const csize = u32(view, p + 20);
    const nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32);
    const local = u32(view, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lnameLen = u16(view, local + 26), lextraLen = u16(view, local + 28);
    const start = local + 30 + lnameLen + lextraLen;
    const raw = bytes.subarray(start, start + csize);
    if (!name.endsWith("/")) {
      if (method === 0) out.set(name, raw.slice());
      else if (method === 8) out.set(name, await inflateRaw(raw));
      else throw new Error("unsupported zip compression method " + method + " for " + name);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
