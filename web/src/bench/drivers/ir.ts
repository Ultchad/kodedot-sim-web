import type { TKey } from '../../i18n/core';
import type { BenchObject, KindDef } from '../model';
import type { AreaDriver } from './types';

export const IR_TV = 'ir.tv';
export const IR_REMOTE = 'ir.remote';
export const REMOTE_BUTTONS = ['Power', 'Vol+', 'Vol-', 'Ch+', 'Ch-', 'Mute'] as const;

const presence = { on: 'presence.aimed', off: 'presence.notAimed' } as const;

export const irKinds: KindDef[] = [
  {
    key: IR_TV,
    area: 'ir',
    labelKey: 'kind.ir.tv',
    descKey: 'kind.ir.tv.desc',
    addKey: 'kind.ir.tv.add',
    fields: [],
    // what the screen shows; the Dot changes it with the remote codes it sends
    defaults: { power: false, volume: 20, channel: 1, muted: false },
    presence,
  },
  {
    key: IR_REMOTE,
    area: 'ir',
    labelKey: 'kind.ir.remote',
    descKey: 'kind.ir.remote.desc',
    addKey: 'kind.ir.remote.add',
    fields: [],
    defaults: {},
    presence,
  },
];

export interface IrTvHandle {
  id: string;
  kind: 'tv';
  aim(v: boolean): unknown;
  update(p: object): unknown;
}
export interface IrRemoteHandle {
  id: string;
  kind: 'remote';
  aim(v: boolean): unknown;
  update(p: object): unknown;
  press(label: string): Promise<unknown>;
  down(label: string): unknown;
  up(): unknown;
}
type IrHandle = IrTvHandle | IrRemoteHandle;
interface IrApi {
  tv(o: object): IrTvHandle;
  remote(o: object): IrRemoteHandle;
  objects(): { id: string }[];
  remove(id: string): boolean;
}

export const ACTION_KEY: Record<string, TKey> = {
  power: 'live.ir.act.power',
  'vol+': 'live.ir.act.volUp',
  'vol-': 'live.ir.act.volDown',
  'ch+': 'live.ir.act.chUp',
  'ch-': 'live.ir.act.chDown',
  mute: 'live.ir.act.mute',
};

export const irDriver: AreaDriver<IrApi, IrHandle> = {
  area: 'ir',
  deviceArea: 'ir',
  events: ['area:ir:tv', 'area:ir:tv-state', 'area:ir:remote', 'area:ir:tx'],
  // the TV's own state is the Dot's to change, so it is not part of the signature
  sig: (o: BenchObject) => JSON.stringify([o.kind, o.name]),
  // the IR area keeps its objects in a persistent region: a new program finds the old ones
  wipe: (api) => {
    for (const o of api.objects()) api.remove(o.id);
  },
  create(api, o, _c, st) {
    const f = o.fields;
    const h: IrHandle =
      o.kind === IR_TV
        ? api.tv({ name: o.name, aimed: o.near, power: !!f.power, volume: Number(f.volume ?? 20), channel: Number(f.channel ?? 1), muted: !!f.muted })
        : api.remote({ name: o.name, aimed: o.near });
    st.byHw.set(h.id, o.id);
    return h;
  },
  update(_api, h, o) {
    h.update({ name: o.name });
    h.aim(o.near);
  },
  remove(api, h, _o, _c, st) {
    st.byHw.delete(h.id);
    api.remove(h.id);
  },
  onEvent(name, d, _api, ctx, st) {
    const type = name.slice('area:ir:'.length);
    if (type === 'tx') return ctx.live.setData('area:ir', { lastTx: d.nec ?? null, txAt: ctx.now() });
    const id = st.byHw.get(d.id);
    if (!id) return;
    if (type === 'tv-state') {
      const s = d.state;
      ctx.report(id, { power: !!s.power, volume: Number(s.volume), channel: Number(s.channel), muted: !!s.muted });
    } else if (type === 'tv') {
      const e = d.entry;
      if (e.type === 'nec' || e.type === 'repeat') {
        if (e.action) ctx.say(id, e.applied === false ? 'live.ir.tv.off' : ACTION_KEY[e.action] ?? 'live.ir.tv.unknown', e.applied === false ? 'bad' : 'ok', { cmd: `0x${Number(e.cmd).toString(16).toUpperCase()}` });
        else ctx.say(id, 'live.ir.tv.unknown', 'info', { cmd: `0x${Number(e.cmd).toString(16).toUpperCase()}` });
      } else if (e.type === 'ignored') ctx.say(id, 'live.ir.tv.ignored', 'bad', { why: String(e.why) });
      else if (e.type === 'raw') ctx.say(id, 'live.ir.tv.raw', 'info', { n: Number(e.n) });
    } else if (type === 'remote') {
      if (d.result) ctx.say(id, 'live.ir.remote.heard', 'ok', { button: String(d.button) });
      else ctx.say(id, 'live.ir.remote.deaf', 'bad', { button: String(d.button), why: String(d.reason) });
    }
  },
  gone(ctx) {
    ctx.live.clear('area:ir');
  },
};
