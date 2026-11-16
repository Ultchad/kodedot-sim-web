import { describe, expect, it } from 'vitest';
import type { KindDef } from './model';
import { BENCH_STORAGE_KEY, BenchStore, type StorageLike } from './store';

const kinds: Record<string, KindDef> = {
  'nfc.tag': { key: 'nfc.tag', area: 'nfc', labelKey: 'kind.motion.pose', descKey: 'kind.motion.pose.desc', fields: [{ key: 'level', labelKey: 'field.pitch', type: 'range', min: 0, max: 10, step: 1 }], defaults: { level: 5, text: 'oi' } },
  'nfc.card': { key: 'nfc.card', area: 'nfc', labelKey: 'kind.motion.pose', descKey: 'kind.motion.pose.desc', fields: [], defaults: {} },
  'sd.card': { key: 'sd.card', area: 'sd', labelKey: 'kind.motion.pose', descKey: 'kind.motion.pose.desc', fields: [], defaults: {} },
};
const kindOf = (k: string) => kinds[k];

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
}

describe('BenchStore', () => {
  it('adds with default name and fields', () => {
    const s = new BenchStore(null, kindOf);
    const o = s.add('nfc.tag')!;
    expect(o.name).toBe('nfc.tag 1');
    expect(o.fields).toEqual({ level: 5, text: 'oi' });
    expect(s.add('nfc.tag')!.name).toBe('nfc.tag 2');
    expect(s.add('nope')).toBeNull();
  });

  it('renames (ignores blank), edits fields with clamping, duplicates, deletes', () => {
    const s = new BenchStore(null, kindOf);
    const o = s.add('nfc.tag')!;
    s.rename(o.id, '  Crachá  ');
    expect(s.get(o.id)!.name).toBe('Crachá');
    s.rename(o.id, '   ');
    expect(s.get(o.id)!.name).toBe('Crachá');
    s.setField(o.id, 'level', 99);
    expect(s.get(o.id)!.fields.level).toBe(10);
    const d = s.duplicate(o.id)!;
    expect(d.id).not.toBe(o.id);
    expect(d.name).toBe('Crachá (cópia)');
    expect(s.getState().objects.map((x) => x.id)).toEqual([o.id, d.id]);
    s.setField(d.id, 'level', 1);
    expect(s.get(o.id)!.fields.level).toBe(10); // copy is independent
    s.remove(o.id);
    expect(s.getState().objects).toHaveLength(1);
  });

  it('slots: bringNear replaces within an area, areas are independent, takeAway by id or area', () => {
    const s = new BenchStore(null, kindOf);
    const a = s.add('nfc.tag')!;
    const b = s.add('nfc.card')!;
    const c = s.add('sd.card')!;
    s.bringNear(a.id);
    s.bringNear(c.id);
    expect(s.activeIn('nfc')!.id).toBe(a.id);
    s.bringNear(b.id);
    expect(s.activeIn('nfc')!.id).toBe(b.id);
    expect(s.activeIn('sd')!.id).toBe(c.id);
    s.takeAway(a.id); // not in slot: no-op
    expect(s.activeIn('nfc')!.id).toBe(b.id);
    s.takeAway(b.id);
    expect(s.activeIn('nfc')).toBeNull();
    s.takeAway('sd');
    expect(s.activeIn('sd')).toBeNull();
  });

  it('deleting the near object empties the slot', () => {
    const s = new BenchStore(null, kindOf);
    const a = s.add('nfc.tag')!;
    s.bringNear(a.id);
    s.remove(a.id);
    expect(s.getState().slots.nfc).toBeUndefined();
  });

  it('notifies subscribers and gives a new snapshot per change', () => {
    const s = new BenchStore(null, kindOf);
    let n = 0;
    const off = s.subscribe(() => n++);
    const before = s.getState();
    s.add('nfc.tag');
    expect(n).toBe(1);
    expect(s.getState()).not.toBe(before);
    off();
    s.add('nfc.tag');
    expect(n).toBe(1);
  });

  it('persists objects (not slots) and reloads them', () => {
    const st = new MemStorage();
    const s = new BenchStore(st, kindOf);
    const o = s.add('nfc.tag', 'Meu')!;
    s.bringNear(o.id);
    const s2 = new BenchStore(st, kindOf);
    expect(s2.getState().objects).toEqual([o]);
    expect(s2.getState().slots).toEqual({});
  });

  it('survives corrupt storage, malformed entries and throwing storage', () => {
    const st = new MemStorage();
    st.setItem(BENCH_STORAGE_KEY, '{not json');
    expect(new BenchStore(st, kindOf).getState().objects).toEqual([]);
    st.setItem(BENCH_STORAGE_KEY, JSON.stringify({ v: 1, objects: [{ id: 'x' }, null, { id: 'ok', area: 'nfc', kind: 'nfc.tag', name: 'A', fields: { level: 1, bad: {} } }, { id: 'ok', area: 'nfc', kind: 'nfc.tag', name: 'dup', fields: {} }, { id: 'z', area: 'mars', kind: 'k', name: 'n', fields: {} }] }));
    const objs = new BenchStore(st, kindOf).getState().objects;
    expect(objs).toHaveLength(1);
    expect(objs[0].fields).toEqual({ level: 1 });
    const boom: StorageLike = {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('quota');
      },
    };
    const s = new BenchStore(boom, kindOf);
    expect(() => s.add('nfc.tag')).not.toThrow();
    expect(s.getState().objects).toHaveLength(1);
  });
});
