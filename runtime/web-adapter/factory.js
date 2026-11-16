// Factory content of the internal volume, host side. A package may carry a factory tree for the internal FAT volume
// ("storage", mounted at /storage): files `factory/storage/<path>` listed in manifest.json `factory.files`
// (tools/dotbench packs it; kodeOS: Kody's pack). The firmware's storage driver (runtime/drivers/storage/vfs.c) copies
// it onto the volume once, when it formats a blank volume at mount time. This module hands the tree to the wasm
// memory BEFORE main(): call installFactory(M, blob) after instantiation, next to restoreInto.
// Platform-neutral (browser, Node): it only needs a Map<string, Uint8Array> of the package entries.

const FACTORY_PREFIX = "factory/storage/";

/** Pack the package's factory tree into the flat archive vfs.c reads, or null when the package has none.
 *  @param {Map<string, Uint8Array>} files  package entries (name -> bytes)
 *  @param {{factory?: {volume?: string, files?: {path: string}[]}}} manifest */
export function factoryBlob(files, manifest) {
  const f = manifest?.factory;
  if (!f || (f.volume ?? "storage") !== "storage" || !Array.isArray(f.files) || !f.files.length) return null;
  const enc = new TextEncoder();
  const parts = [];
  let total = 0;
  for (const { path } of f.files) {
    const data = files.get(FACTORY_PREFIX + path);
    if (!data) throw new Error("package lists factory file " + path + " but does not contain it");
    const p = enc.encode(path);
    if (!p.length || p.length > 200) throw new Error("factory path too long: " + path);
    const head = new Uint8Array(2 + p.length + 4);
    head[0] = p.length & 255; head[1] = p.length >> 8;
    head.set(p, 2);
    new DataView(head.buffer).setUint32(2 + p.length, data.length, true);
    parts.push(head, data);
    total += head.length + data.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Copy the archive into the module's memory and tell the storage driver where it is (once per instance, before main()).
 *  A module built without the storage area (no dbfs_seed_set) ignores it. */
export function installFactory(M, blob) {
  if (!blob || typeof M._dbfs_seed_set !== "function") return false;
  const p = M._malloc(blob.length);
  M.HEAPU8.set(blob, p);
  M._dbfs_seed_set(p, blob.length);
  return true;
}
