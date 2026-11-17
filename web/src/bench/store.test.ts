import { describe, expect, it } from 'vitest';
import type { KindDef } from './model';
import { BENCH_STORAGE_KEY, BenchStore, type StorageLike } from './store';

const base = { labelKey: 'kind.motion.pose', descKey: 'kind.motion.pose.desc', fields: [] as never[] } as const;
const kinds: Record<string, KindDef> = {
  'nfc.tag': { ...base, key: 'nfc.tag', area: 'nfc', fields: [{ key: 'level', labelKey: 'field.pitch', type: 'range', min: 0, max: 10, step: 1 }], defaults: { level: 5, text: 'oi' }, unique: (n) => ({ uid: `uid${n}` }) },
  'nfc.card': { ...base, key: 'nfc.card', area: 'nfc', defaults: {} },
  'sd.card': { ...base, key: 'sd.card', area: 'sd', defaults: {}, presence: 'none' },
  'power.battery': { ...base, key: 'power.battery', area: 'power', defaults: {}, single: true },
  'motion.pose': { ...base, key: 'motion.pose', area: 'motion', defaults: {} },
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
  it('adds with default name and fields, unique ones per object, and starts near', () => {
    const s = new BenchStore(null, kindOf);
    const o = s.add('nfc.tag')!;
    expect(o.name).toBe('nfc.tag 1');
    expect(o.fields).toEqual({ level: 5, text: 'oi', uid: 'uid1' });
    expect(o.near).toBe(true);
    expect(s.add('nfc.tag')!.fields.uid).toBe('uid2');
    expect(s.add('nope')).toBeNull();
    expect(s.add('sd.card')!.near).toBe(false); // no near/away control
  });

  it('renames (ignores blank), edits fields with clamping, duplicates (away, new unique fields), deletes', () => {
    const s = new BenchStore(null, kindOf);
    const o = s.add('nfc.tag')!;
    s.rename(o.id, '  Crachá  ');
    expect(s.get(o.id)!.name).toBe('Crachá');
    s.rename(o.id, '   ');
    expect(s.get(o.id)!.name).toBe('Crachá');
    s.setField(o.id, 'level', 99);
    expect(s.get(o.id)!.fields.level).toBe(10);
    const d = s.duplicate(o.id, 'copy')!;
    expect(d.name).toBe('Crachá (copy)');
    expect(d.near).toBe(false);
    expect(d.fields.uid).not.toBe(o.fields.uid);
    expect(s.getState().objects.map((x) => x.id)).toEqual([o.id, d.id]);
    s.setField(d.id, 'level', 1);
    expect(s.get(o.id)!.fields.level).toBe(10);
    s.remove(o.id);
    expect(s.getState().objects).toHaveLength(1);
  });

  it('several objects of an area can be near at once; takeAway by id or by area', () => {
    const s = new BenchStore(null, kindOf);
    const a = s.add('nfc.tag')!;
    const b = s.add('nfc.card')!;
    expect(s.nearIn('nfc').map((o) => o.id)).toEqual([a.id, b.id]);
    s.takeAway(a.id);
    expect(s.nearIn('nfc').map((o) => o.id)).toEqual([b.id]);
    s.setNear(a.id, true);
    s.takeAway('nfc');
    expect(s.nearIn('nfc')).toEqual([]);
  });

  it('an exclusive area (motion) has one near object: the others leave', () => {
    const s = new BenchStore(null, kindOf);
    const a = s.add('motion.pose')!;
    const b = s.add('motion.pose')!;
    expect(a.near).toBe(true);
    expect(b.near).toBe(false);
    s.setNear(b.id, true);
    expect(s.activeIn('motion')!.id).toBe(b.id);
    expect(s.get(a.id)!.near).toBe(false);
  });

  it('single kinds: a second one is refused and cannot be duplicated', () => {
    const s = new BenchStore(null, kindOf);
    const a = s.add('power.battery')!;
    expect(s.add('power.battery')).toBeNull();
    expect(s.duplicate(a.id)).toBeNull();
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

  it('persists objects with their near state and reloads them', () => {
    const st = new MemStorage();
    const s = new BenchStore(st, kindOf);
    const o = s.add('nfc.tag', 'Meu')!;
    const p = s.add('nfc.card')!;
    s.takeAway(p.id);
    const s2 = new BenchStore(st, kindOf);
    expect(s2.getState().objects).toEqual([o, { ...p, near: false }]);
    expect(s2.nearIn('nfc').map((x) => x.id)).toEqual([o.id]);
  });

  it('reads the first version (no near flag) as away', () => {
    const st = new MemStorage();
    st.setItem(BENCH_STORAGE_KEY, JSON.stringify({ v: 1, objects: [{ id: 'a', area: 'motion', kind: 'motion.pose', name: 'M', fields: { pitch: 3 } }] }));
    const o = new BenchStore(st, kindOf).getState().objects[0];
    expect(o.near).toBe(false);
    expect(o.fields).toEqual({ pitch: 3 });
  });

  it('survives corrupt storage, malformed entries and throwing storage', () => {
    const st = new MemStorage();
    st.setItem(BENCH_STORAGE_KEY, '{not json');
    expect(new BenchStore(st, kindOf).getState().objects).toEqual([]);
    st.setItem(BENCH_STORAGE_KEY, JSON.stringify({ v: 2, objects: [{ id: 'x' }, null, { id: 'ok', area: 'nfc', kind: 'nfc.tag', name: 'A', near: true, fields: { level: 1, bad: {} } }, { id: 'ok', area: 'nfc', kind: 'nfc.tag', name: 'dup', fields: {} }, { id: 'z', area: 'mars', kind: 'k', name: 'n', fields: {} }] }));
    const objs = new BenchStore(st, kindOf).getState().objects;
    expect(objs).toHaveLength(1);
    expect(objs[0].fields).toEqual({ level: 1 });
    expect(objs[0].near).toBe(true);
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
