import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { BundleStore } from './bundles';

const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251)).buffer;

describe('BundleStore (fake IndexedDB)', () => {
  it('adds, lists newest first with size, gets bytes back, removes', async () => {
    const s = new BundleStore(new IDBFactory(), 't1');
    expect(await s.list()).toEqual([]);
    const a = await s.add('a.dotbench', bytes(10), 1000);
    const b = await s.add('b.dotbench', bytes(2048), 2000);
    const list = await s.list();
    expect(list.map((m) => m.name)).toEqual(['b.dotbench', 'a.dotbench']);
    expect(list[0].size).toBe(2048);
    expect(list[1].addedAt).toBe(1000);
    const got = await s.get(a.id);
    expect(got!.meta.name).toBe('a.dotbench');
    expect(new Uint8Array(got!.data)).toEqual(new Uint8Array(bytes(10)));
    await s.remove(a.id);
    expect((await s.list()).map((m) => m.id)).toEqual([b.id]);
    expect(await s.get(a.id)).toBeNull();
  });

  it('persists across store instances on the same factory', async () => {
    const f = new IDBFactory();
    const s1 = new BundleStore(f, 't2');
    await s1.add('x.dotbench', bytes(5), 1);
    await s1.close();
    const s2 = new BundleStore(f, 't2');
    expect((await s2.list()).map((m) => m.name)).toEqual(['x.dotbench']);
  });

  it('get of unknown id is null and remove of unknown id does not throw', async () => {
    const s = new BundleStore(new IDBFactory(), 't3');
    expect(await s.get('nope')).toBeNull();
    await expect(s.remove('nope')).resolves.toBeUndefined();
  });
});
