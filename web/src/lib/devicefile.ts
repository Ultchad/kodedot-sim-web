/**
 * A tiny container for "Export device" files, used only while the adapter offers just the raw persistent
 * regions (exportPersist: Map<name, bytes>). When the adapter grows its own whole-device format, that wins
 * (see WasmDevice.exportDevice) and this file format is not written any more.
 *
 * Layout: "DOTBENCH-DEVICE\n1\n" + JSON line [{name,size}...] + "\n" + the regions back to back.
 */
const MAGIC = 'DOTBENCH-DEVICE\n1\n';
const enc = new TextEncoder();
const dec = new TextDecoder();

export function packRegions(regions: Map<string, Uint8Array>): Uint8Array {
  const index = JSON.stringify([...regions].map(([name, data]) => ({ name, size: data.byteLength })));
  const head = enc.encode(MAGIC + index + '\n');
  let total = head.byteLength;
  for (const d of regions.values()) total += d.byteLength;
  const out = new Uint8Array(total);
  out.set(head, 0);
  let at = head.byteLength;
  for (const d of regions.values()) {
    out.set(d, at);
    at += d.byteLength;
  }
  return out;
}

export function unpackRegions(bytes: Uint8Array): Map<string, Uint8Array> {
  const magic = enc.encode(MAGIC);
  if (bytes.byteLength < magic.byteLength || dec.decode(bytes.subarray(0, magic.byteLength)) !== MAGIC) throw new Error('not a dotbench device file');
  const nl = bytes.indexOf(10, magic.byteLength);
  if (nl < 0) throw new Error('damaged device file (no index)');
  const index = JSON.parse(dec.decode(bytes.subarray(magic.byteLength, nl))) as { name: string; size: number }[];
  const map = new Map<string, Uint8Array>();
  let at = nl + 1;
  for (const { name, size } of index) {
    if (!Number.isInteger(size) || size < 0 || at + size > bytes.byteLength) throw new Error('damaged device file (truncated)');
    map.set(name, bytes.slice(at, at + size));
    at += size;
  }
  return map;
}
