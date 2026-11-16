/**
 * A model file as one binary glTF (.glb), whatever the user picked.
 *
 * A .glb passes through. A .gltf (the JSON form) is repacked into a .glb in
 * memory when everything it needs is inside the file itself (buffers and
 * images as data: URIs, which is what "embedded" exports write). A .gltf that
 * points at separate .bin or picture files cannot be read from one dropped
 * file: the error says so and what to export instead.
 *
 * Repacking, rather than handing the JSON to the loader, keeps the page's
 * Content-Security-Policy as it is: the loader would fetch each data: URI, and
 * connect-src allows only this site and blob: URLs.
 *
 * No three.js here: the page's menu code imports this file.
 */
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function isGlb(buffer: ArrayBuffer): boolean {
  return buffer.byteLength >= 12 && new DataView(buffer).getUint32(0, true) === GLB_MAGIC;
}

interface GltfJson {
  asset?: { version?: string };
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  [key: string]: unknown;
}

function dataUri(uri: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),/.exec(uri);
  if (!m) return null;
  const body = uri.slice(m[0].length);
  if (/;base64/i.test(m[2])) {
    const bin = atob(body.replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes };
  }
  return { mime: m[1], bytes: new TextEncoder().encode(decodeURIComponent(body)) };
}

const pad4 = (n: number) => (n + 3) & ~3;

/** Returns the file as a .glb. Throws an Error with a readable message when that cannot be done. */
export function toGlb(buffer: ArrayBuffer): ArrayBuffer {
  if (isGlb(buffer)) return buffer;
  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) as GltfJson;
  } catch {
    throw new Error('This is neither a .glb nor a .gltf file.');
  }
  if (!json || typeof json !== 'object' || typeof json.asset?.version !== 'string') throw new Error('This is neither a .glb nor a .gltf file.');
  if (!json.asset.version.startsWith('2')) throw new Error(`This file is glTF version ${json.asset.version}; only version 2 is supported.`);

  const outside: string[] = [];
  const parts: Uint8Array[] = [];
  let length = 0;
  const append = (bytes: Uint8Array): number => {
    const at = length;
    parts.push(bytes);
    length = pad4(length + bytes.byteLength);
    return at;
  };

  // every buffer into one binary chunk
  const starts: number[] = [];
  for (const b of json.buffers ?? []) {
    const d = typeof b.uri === 'string' ? dataUri(b.uri) : null;
    if (!d) {
      outside.push(typeof b.uri === 'string' ? b.uri : 'a buffer without data');
      starts.push(0);
      continue;
    }
    starts.push(append(d.bytes));
  }
  const views = (json.bufferViews ??= []);
  for (const v of views) {
    v.byteOffset = (v.byteOffset ?? 0) + (starts[v.buffer] ?? 0);
    v.buffer = 0;
  }
  // pictures become buffer views
  for (const img of json.images ?? []) {
    if (typeof img.uri !== 'string') continue;
    const d = dataUri(img.uri);
    if (!d) {
      outside.push(img.uri);
      continue;
    }
    views.push({ buffer: 0, byteOffset: append(d.bytes), byteLength: d.bytes.byteLength });
    img.bufferView = views.length - 1;
    img.mimeType = img.mimeType ?? (d.mime || 'image/png');
    delete img.uri;
  }
  if (outside.length) {
    const names = outside.slice(0, 3).map((u) => u.split(/[\\/]/).pop()).join(', ');
    throw new Error(`This .gltf needs separate files (${names}${outside.length > 3 ? ', …' : ''}) that were not given. Export the model as a single .glb, or as a .gltf with everything embedded.`);
  }
  json.buffers = length ? [{ byteLength: length }] : [];

  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(text.byteLength);
  const total = 12 + 8 + jsonLen + (length ? 8 + length : 0);
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, GLB_MAGIC, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, CHUNK_JSON, true);
  u8.fill(0x20, 20, 20 + jsonLen);
  u8.set(text, 20);
  if (length) {
    const at = 20 + jsonLen;
    dv.setUint32(at, length, true);
    dv.setUint32(at + 4, CHUNK_BIN, true);
    let o = at + 8;
    for (const p of parts) {
      u8.set(p, o);
      o += pad4(p.byteLength);
    }
  }
  return out;
}
