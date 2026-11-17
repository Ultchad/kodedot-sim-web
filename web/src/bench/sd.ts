/** The microSD card in the Dot's slot, seen from the page: slot state from the `sd` area, files through the `storage` area. */

export interface SdAreaApi {
  state(): { inserted: boolean; capacityMb: number; serial: number; writeProtect: boolean; generation: number; mounted: boolean };
  insert(): void;
  eject(): void;
  swap(mb: number, o?: { format?: boolean }): void;
  setWriteProtect(wp: boolean): void;
  mount(): void;
  /** What the card really occupies and the most real data it can hold (sparse store). */
  stats?(): { storedBytes: number; boundBytes: number; poolBytes: number; layout: 'dense' | 'sparse'; known: boolean };
}
export interface StorageApi {
  list(path: string): { name: string; type: 'file' | 'dir'; size: number }[];
  read(path: string): Uint8Array;
  write(path: string, data: Uint8Array | ArrayBuffer | string): number;
  remove(path: string): void;
  mkdir(path: string): void;
  usage(vol: 'storage' | 'sdcard'): { total: number; free: number; used: number };
  mounted(vol: 'storage' | 'sdcard'): boolean;
}

export const SD_ROOT = '/sdcard';
/** Nominal card sizes the bench offers. Sparse: only written blocks are stored (runtime/drivers/sd/sdcard.c), so 128 GB costs what is on it. */
export const SD_SIZES_MB = [4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072] as const;
/** "512 MB", "1 GB", "128 GB": the unit people read on a card. */
export const sizeLabel = (mb: number): string => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);
/** The card's FAT keeps names to 255 characters; the Dot's own paths to 160. */
export const MAX_PATH = 150;

export interface SdSnapshot {
  inserted: boolean;
  capacityMb: number;
  writeProtect: boolean;
  mounted: boolean;
  usage: { total: number; free: number; used: number } | null;
  /** Large cards keep only what was written: bytes really kept in this browser, and how much it can keep. */
  kept: { stored: number; bound: number } | null;
  path: string;
  entries: { name: string; type: 'file' | 'dir'; size: number }[];
  error: string | null;
}

/** A file name the card can hold: no path parts, no characters FAT refuses. */
export function cardName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base.replace(/[\u0000-\u001f"*:<>?|]/g, '_').replace(/^[. ]+|[. ]+$/g, '');
  return clean.slice(0, 120) || 'file';
}

/** `name`, or `name (2)` before the extension, until it is free in `dir`. */
export function freeName(taken: ReadonlySet<string>, name: string): string {
  if (!taken.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!taken.has(c.toLowerCase())) return c;
  }
}

export const joinPath = (dir: string, name: string): string => `${dir.replace(/\/$/, '')}/${name}`;
export const parentPath = (p: string): string => (p === SD_ROOT ? SD_ROOT : p.slice(0, p.lastIndexOf('/')) || SD_ROOT);

export function snapshot(sd: SdAreaApi, fs: StorageApi, path: string): SdSnapshot {
  const s = sd.state();
  const out: SdSnapshot = { inserted: s.inserted, capacityMb: s.capacityMb, writeProtect: s.writeProtect, mounted: s.mounted, usage: null, kept: null, path, entries: [], error: null };
  try {
    const st = sd.stats?.();
    if (st && st.known && st.layout === 'sparse') out.kept = { stored: st.storedBytes, bound: st.boundBytes };
  } catch {
    /* an older package without stats */
  }
  if (!s.inserted || !s.mounted) return out;
  try {
    out.usage = fs.usage('sdcard');
    out.entries = fs
      .list(path)
      .filter((e) => !e.name.startsWith('.'))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  } catch (e) {
    out.error = String((e as Error).message ?? e);
  }
  return out;
}

/** Puts a file on the card in `dir`, under a free name. Returns the name it got. */
export function addFile(fs: StorageApi, dir: string, name: string, data: Uint8Array): string {
  const taken = new Set(fs.list(dir).map((e) => e.name.toLowerCase()));
  const final = freeName(taken, cardName(name));
  const path = joinPath(dir, final);
  if (path.length > MAX_PATH) throw new Error('ENAMETOOLONG');
  fs.write(path, data);
  return final;
}
