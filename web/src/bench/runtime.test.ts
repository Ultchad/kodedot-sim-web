import { afterEach, describe, expect, it } from 'vitest';
import { Atom } from '../device/observable';
import type { KodeDevice } from '../device/types';
import { DRIVERS } from './drivers';
import { LiveStore } from './live';
import { BenchRuntime } from './runtime';
import { BenchStore } from './store';

// ---- fakes of the area glue: the same shapes as runtime/drivers/<area>/*.js, recording what the page asks of them
function fakeNfc(leftover = 0) {
  const calls: string[] = [];
  const objs = new Map<number, ReturnType<typeof handle>>();
  let seq = 0;
  const handle = (kind: string, spec: Record<string, unknown>) => {
    const id = ++seq;
    const st = { near: false, uid: String(spec.uid), locked: !!spec.locked };
    const h = {
      id,
      kind,
      spec,
      info: () => ({ ...st }),
      near: () => ((st.near = true), calls.push(`near ${id}`)),
      away: () => ((st.near = false), calls.push(`away ${id}`)),
      remove: () => (objs.delete(id), calls.push(`remove ${id}`)),
      update: (p: Record<string, unknown>) => (Object.assign(spec, p), calls.push(`update ${id} ${JSON.stringify(p)}`)),
    };
    objs.set(id, h);
    return h;
  };
  for (let i = 0; i < leftover; i++) handle('tag', { uid: '04:00:00:00:00:00:00' });
  const api = {
    tag: (s: Record<string, unknown>) => (calls.push('tag'), handle('tag', s)),
    card: (s: Record<string, unknown>) => (calls.push('card'), handle('card', s)),
    reader: (s: Record<string, unknown>) => (calls.push('reader'), handle('reader', s)),
    objects: () => [...objs.values()],
    reset: () => (objs.clear(), calls.push('reset')),
  };
  return { api, calls, objs };
}

function fakeWifi(leftover = 0) {
  const routers: { id: number; ssid: string; cfg: Record<string, unknown>; update(p: object): void }[] = [];
  let seq = 0;
  const add = (cfg: Record<string, unknown>) => {
    const r = { id: ++seq, ssid: String(cfg.ssid), cfg, update: (p: object) => void Object.assign(r.cfg, p) };
    routers.push(r);
    return r;
  };
  for (let i = 0; i < leftover; i++) add({ ssid: 'old' });
  return {
    routers,
    api: {
      addRouter: add,
      removeRouter: (r: { id: number }) => void routers.splice(routers.findIndex((x) => x.id === r.id), 1),
      clearRouters: () => void routers.splice(0),
      station: () => ({ connected: null, connecting: false, started: true }),
    },
  };
}

function fakeIr(leftover = 0) {
  const objs = new Map<string, { id: string; kind: string; spec: Record<string, unknown>; aim(v: boolean): void; update(p: object): void }>();
  let seq = 0;
  const mk = (kind: string) => (spec: Record<string, unknown>) => {
    const id = `${kind}${++seq}`;
    const h = { id, kind, spec, aim: (v: boolean) => void (spec.aimed = v), update: (p: object) => void Object.assign(spec, p) };
    objs.set(id, h);
    return h;
  };
  const tv = mk('tv');
  for (let i = 0; i < leftover; i++) tv({ name: 'old' });
  return { objs, api: { tv, remote: mk('remote'), objects: () => [...objs.values()], remove: (id: string) => objs.delete(id) } };
}

class FakeDevice {
  areas: Record<string, unknown> = {};
  program = new Atom<unknown>({ id: 'os' });
  status = new Atom<string>('running');
  info = { kind: 'wasm', label: 'fake', runsBundles: true };
  private subs = new Map<string, Set<(d: unknown) => void>>();
  onEvent(name: string, cb: (d: unknown) => void) {
    if (!this.subs.has(name)) this.subs.set(name, new Set());
    this.subs.get(name)!.add(cb);
    return () => void this.subs.get(name)!.delete(cb);
  }
  emit(name: string, data: unknown) {
    for (const cb of this.subs.get(name) ?? []) cb(data);
  }
  /** a new program starts: its glue is new objects */
  boot(areas: Record<string, unknown>) {
    this.areas = areas;
    this.program.set({ id: Math.random() });
  }
}

let rt: BenchRuntime | null = null;
afterEach(() => rt?.detach());

function setup(areas: Record<string, unknown>) {
  const bench = new BenchStore(null);
  const live = new LiveStore();
  const dev = new FakeDevice();
  dev.areas = areas;
  rt = new BenchRuntime(bench, live, DRIVERS);
  rt.attach(dev as unknown as KodeDevice);
  return { bench, live, dev, rt };
}

describe('BenchRuntime: NFC', () => {
  it('a new tag is created with its text and put near at once', () => {
    const nfc = fakeNfc();
    const { bench } = setup({ nfc: nfc.api });
    const o = bench.add('nfc.tag')!;
    const h = [...nfc.objs.values()][0];
    expect(h.spec.text).toBe('Hello');
    expect(h.spec.uid).toBe(o.fields.uid);
    expect(h.info().near).toBe(true);
  });

  it('the object is still there after another program starts: wiped, recreated once, never duplicated', () => {
    const first = fakeNfc();
    const { bench, dev } = setup({ nfc: first.api });
    bench.add('nfc.tag');
    expect(first.objs.size).toBe(1);
    // NFC keeps its objects in a persistent region: the next program finds the old one in its glue
    const second = fakeNfc(1);
    dev.boot({ nfc: second.api });
    expect(second.calls.filter((c) => c === 'reset')).toHaveLength(1);
    expect(second.calls.filter((c) => c === 'tag')).toHaveLength(1);
    expect(second.objs.size).toBe(1);
    expect([...second.objs.values()][0].info().near).toBe(true);
    // and a third time
    const third = fakeNfc(2);
    dev.boot({ nfc: third.api });
    expect(third.objs.size).toBe(1);
  });

  it('a tag taken away stays away in the next program', () => {
    const a = fakeNfc();
    const { bench, dev } = setup({ nfc: a.api });
    const o = bench.add('nfc.tag')!;
    bench.setNear(o.id, false);
    const b = fakeNfc();
    dev.boot({ nfc: b.api });
    expect([...b.objs.values()][0].info().near).toBe(false);
  });

  it('edits go to the device, removal removes, near toggles', () => {
    const nfc = fakeNfc();
    const { bench } = setup({ nfc: nfc.api });
    const o = bench.add('nfc.tag')!;
    bench.setField(o.id, 'text', 'changed');
    expect([...nfc.objs.values()][0].spec.text).toBe('changed');
    bench.setField(o.id, 'mode', 'link');
    expect([...nfc.objs.values()][0].spec.uri).toBe('https://example.com');
    bench.setNear(o.id, false);
    expect([...nfc.objs.values()][0].info().near).toBe(false);
    bench.remove(o.id);
    expect(nfc.objs.size).toBe(0);
  });

  it('what the Dot writes to a tag is kept in the bench and not pushed back', () => {
    const nfc = fakeNfc();
    const { bench, dev, live } = setup({ nfc: nfc.api });
    const o = bench.add('nfc.tag')!;
    const hw = [...nfc.objs.values()][0];
    const before = nfc.calls.length;
    dev.emit('area:nfc:written', { id: hw.id, content: { text: 'from the Dot', records: [] } });
    expect(bench.get(o.id)!.fields.text).toBe('from the Dot');
    expect(nfc.calls.slice(before).filter((c) => c.startsWith('update'))).toEqual([]);
    expect(live.get(o.id).entries.at(-1)?.key).toBe('live.nfc.written');
    // and the next program starts with it
    const next = fakeNfc();
    dev.boot({ nfc: next.api });
    expect([...next.objs.values()][0].spec.text).toBe('from the Dot');
  });

  it('a bad UID is reported on the object and nothing is created', () => {
    const nfc = fakeNfc();
    const { bench, live } = setup({ nfc: nfc.api });
    const o = bench.add('nfc.tag')!;
    bench.setField(o.id, 'uid', 'zz');
    expect(live.get(o.id).entries.at(-1)?.key).toBe('live.error');
    expect(nfc.objs.size).toBe(1); // the one made before the bad edit
  });

  it('the error goes away once a later edit applies', () => {
    const nfc = fakeNfc();
    const { bench, live } = setup({ nfc: nfc.api });
    const o = bench.add('nfc.tag')!;
    bench.setField(o.id, 'uid', 'zz');
    expect(live.get(o.id).entries.some((e) => e.key === 'live.error')).toBe(true);
    bench.setField(o.id, 'uid', '04:11:22:33:44:55:66');
    expect(live.get(o.id).entries.some((e) => e.key === 'live.error')).toBe(false);
  });

  it('reads count up on the object', () => {
    const nfc = fakeNfc();
    const { bench, dev, live } = setup({ nfc: nfc.api });
    const o = bench.add('nfc.tag')!;
    const id = [...nfc.objs.values()][0].id;
    dev.emit('area:nfc:read', { id, reads: 1 });
    dev.emit('area:nfc:read', { id, reads: 2 });
    expect(live.get(o.id).entries.at(-1)).toMatchObject({ key: 'live.nfc.read', count: 2 });
    dev.emit('area:nfc:read', { id: 999, reads: 3 }); // an object that is not ours: ignored
    expect(live.get(o.id).entries.at(-1)?.count).toBe(2);
  });

  it('the Dot off and on again: the object is rebuilt', () => {
    const a = fakeNfc();
    const { bench, dev } = setup({ nfc: a.api });
    bench.add('nfc.tag');
    dev.boot({});
    const b = fakeNfc();
    dev.boot({ nfc: b.api });
    expect(b.objs.size).toBe(1);
  });
});

describe('BenchRuntime: Wi-Fi', () => {
  it('routers left in a cached module are cleared, then the bench ones are added once', () => {
    const w = fakeWifi();
    const { bench, dev } = setup({ wifi: w.api });
    bench.add('wifi.router');
    expect(w.routers).toHaveLength(1);
    const again = fakeWifi(2);
    dev.boot({ wifi: again.api });
    expect(again.routers.map((r) => r.ssid)).toEqual(['Home WiFi']);
  });

  it('range and power follow the bench; a short password is refused with a message', () => {
    const w = fakeWifi();
    const { bench, live } = setup({ wifi: w.api });
    const o = bench.add('wifi.router')!;
    bench.setNear(o.id, false);
    expect(w.routers[0].cfg.inRange).toBe(false);
    bench.setField(o.id, 'security', 'wpa2');
    bench.setField(o.id, 'password', 'short');
    expect(live.get(o.id).entries.at(-1)?.key).toBe('live.error');
    expect(w.routers[0].cfg.password).toBe('12345678'); // the bad one never reached the router
    bench.setField(o.id, 'password', 'longenough1');
    expect(w.routers[0].cfg).toMatchObject({ security: 'wpa2', password: 'longenough1' });
  });
});

describe('BenchRuntime: infrared', () => {
  it('a TV the Dot switched on is still on in the next program, and old ones are wiped', () => {
    const a = fakeIr();
    const { bench, dev } = setup({ ir: a.api });
    const o = bench.add('ir.tv')!;
    const tv = [...a.objs.values()][0];
    dev.emit('area:ir:tv-state', { id: tv.id, state: { power: true, volume: 31, channel: 7, muted: false } });
    expect(bench.get(o.id)!.fields).toMatchObject({ power: true, volume: 31, channel: 7 });
    const b = fakeIr(1);
    dev.boot({ ir: b.api });
    expect(b.objs.size).toBe(1);
    expect([...b.objs.values()][0].spec).toMatchObject({ power: true, volume: 31, channel: 7, aimed: true });
  });

  it('pointing away is passed to the object', () => {
    const a = fakeIr();
    const { bench } = setup({ ir: a.api });
    const o = bench.add('ir.remote')!;
    bench.setNear(o.id, false);
    expect([...a.objs.values()][0].spec.aimed).toBe(false);
  });

  it('what a remote did is reported, and a repeated line counts up', () => {
    const a = fakeIr();
    const { bench, dev, live } = setup({ ir: a.api });
    const o = bench.add('ir.remote')!;
    const r = [...a.objs.values()][0];
    for (let i = 0; i < 3; i++) dev.emit('area:ir:remote', { id: r.id, button: 'Vol+', result: false, reason: 'not armed' });
    expect(live.get(o.id).entries.at(-1)).toMatchObject({ key: 'live.ir.remote.deaf', count: 3 });
  });
});

describe('BenchRuntime: RFID', () => {
  it('objects are made in a fresh world and a tag keeps what the Dot wrote', () => {
    const made: Record<string, Record<string, unknown>> = {};
    const near = new Set<string>();
    let n = 0;
    const blocks = [0x00148040, 1, 2, 0, 0, 0, 0, 0];
    const api = {
      createCard: (j: Record<string, unknown>) => ((made[`card${++n}`] = j), { key: `card${n}` }),
      createTag: (j: Record<string, unknown>) => ((made[`tag${++n}`] = j), { key: `tag${n}` }),
      createReader: (j: Record<string, unknown>) => ((made[`reader${++n}`] = j), { key: `reader${n}` }),
      update: (k: string, p: object) => (Object.assign(made[k], p), { blocks }),
      remove: (k: string) => void delete made[k],
      bringNear: (k: string) => void near.add(k),
      takeAway: (k: string) => void near.delete(k),
      isNear: (k: string) => near.has(k),
      get: () => ({ blocks, id: '01:02:03:04:05' }),
      list: () => [],
      reset: () => {},
    };
    const { bench, dev } = setup({ rfid: api });
    const card = bench.add('rfid.card')!;
    const tag = bench.add('rfid.tag')!;
    expect(Object.keys(made)).toEqual(['card1', 'tag2']);
    expect(near.has('card1')).toBe(true);
    expect((made.card1.id as string).split(':')).toHaveLength(5);
    dev.emit('area:rfid:block-written', { key: 'tag2', block: 2, data: 2, locked: false });
    expect(bench.get(tag.id)!.fields.blocks).toBe('00148040,00000001,00000002,00000000,00000000,00000000,00000000,00000000');
    n = 0;
    for (const k of Object.keys(made)) delete made[k];
    near.clear();
    dev.boot({ rfid: { ...api } });
    expect(Object.keys(made)).toHaveLength(2);
    expect(made.tag2.blocks).toEqual(blocks);
    expect(bench.get(card.id)!.near).toBe(true);
  });
});

describe('BenchRuntime: power', () => {
  it('battery and charger are applied, and again to the next program', () => {
    const calls: string[] = [];
    const mk = () => ({ plug: (on: boolean, k?: string) => calls.push(`plug ${on} ${k}`), setLevel: (p: number) => calls.push(`level ${p}`), level: () => 50, voltage: () => 3800, charging: () => 'none', cable: () => 'none', currentMa: () => 0 });
    const { bench, dev } = setup({ power: mk() });
    const b = bench.add('power.battery')!;
    bench.setField(b.id, 'level', 35);
    bench.add('power.charger');
    expect(calls).toEqual(['level 80', 'level 35', 'plug true usb']);
    calls.length = 0;
    dev.boot({ power: mk() });
    expect(calls.sort()).toEqual(['level 35', 'plug true usb']);
  });
});

describe('BenchRuntime: motion', () => {
  it('the near object decides the pose, none = flat', () => {
    const poses: unknown[] = [];
    const { bench } = setup({ motion: { setPose: (p: unknown) => poses.push(p) } });
    const o = bench.add('motion.pose')!;
    bench.setField(o.id, 'pitch', 30);
    expect(poses.at(-1)).toMatchObject({ pitch: 30 });
    bench.setNear(o.id, false);
    expect(poses.at(-1)).toBeNull();
  });
});
