import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
const library = JSON.parse(readFileSync(join(web, '..', 'parts', 'prebuilt', 'library.json'), 'utf8')).parts as { id: string }[];
const index = JSON.parse(readFileSync(join(web, 'public', 'parts-thumbs', 'index.json'), 'utf8')) as { thumbs: Record<string, string>; fallback: string[] };

describe('library part pictures (scripts/part-thumbs.mjs)', () => {
  it('every library part has a picture file in the index, or is knowingly on the fallback list', () => {
    for (const p of library) {
      const f = index.thumbs[p.id];
      if (f) expect(existsSync(join(web, 'public', 'parts-thumbs', f)), `${p.id}: ${f} is missing`).toBe(true);
      else expect(index.fallback, `${p.id} has neither a picture nor a place on the fallback list: run node scripts/part-thumbs.mjs`).toContain(p.id);
    }
  });
  it('lists no part twice and no part that is not in the library', () => {
    const ids = new Set(library.map((p) => p.id));
    for (const id of [...Object.keys(index.thumbs), ...index.fallback]) expect(ids.has(id), id).toBe(true);
    for (const id of index.fallback) expect(index.thumbs[id], id).toBeUndefined();
  });
});
