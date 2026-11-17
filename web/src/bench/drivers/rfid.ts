import type { BenchObject, KindDef } from '../model';
import { needBytes, randomHex } from './util';
import type { AreaDriver } from './types';

export const RFID_CARD = 'rfid.card';
export const RFID_TAG = 'rfid.tag';
export const RFID_READER = 'rfid.reader';

export const rfidKinds: KindDef[] = [
  {
    key: RFID_CARD,
    area: 'rfid',
    labelKey: 'kind.rfid.card',
    descKey: 'kind.rfid.card.desc',
    addKey: 'kind.rfid.card.add',
    fields: [{ key: 'id', labelKey: 'field.cardNumber', type: 'text', mono: true, placeholder: '01:02:03:04:05' }],
    defaults: { id: '01:02:03:04:05' },
    unique: () => ({ id: randomHex(5, [0x01]) }),
  },
  {
    key: RFID_TAG,
    area: 'rfid',
    labelKey: 'kind.rfid.tag',
    descKey: 'kind.rfid.tag.desc',
    addKey: 'kind.rfid.tag.add',
    fields: [{ key: 'writeProtected', labelKey: 'field.writeProtected', type: 'toggle' }],
    // `blocks` is what the Dot has written (8 words, hex); empty = a blank tag from the factory
    defaults: { blocks: '', writeProtected: false },
  },
  {
    key: RFID_READER,
    area: 'rfid',
    labelKey: 'kind.rfid.reader',
    descKey: 'kind.rfid.reader.desc',
    addKey: 'kind.rfid.reader.add',
    fields: [{ key: 'expected', labelKey: 'field.grantsNumber', type: 'text', mono: true, placeholder: '01:02:03:04:05' }],
    defaults: { expected: '01:02:03:04:05' },
  },
];

interface RfidApi {
  createCard(j: object): { key: string };
  createTag(j: object): { key: string };
  createReader(j: object): { key: string };
  update(key: string, p: object): { blocks?: number[]; id?: string | null };
  remove(key: string): void;
  bringNear(key: string): void;
  takeAway(key: string): void;
  isNear(key: string): boolean;
  get(key: string): { blocks?: number[]; id?: string | null };
  list(): { key: string }[];
  reset(): void;
}

export const blocksToString = (b: readonly number[]): string => b.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join(',');
export const blocksFromString = (s: string): number[] | null => {
  if (!s) return null;
  const p = s.split(',');
  return p.length === 8 && p.every((x) => /^[0-9a-f]{1,8}$/i.test(x)) ? p.map((x) => parseInt(x, 16) >>> 0) : null;
};

function spec(o: BenchObject): Record<string, unknown> {
  if (o.kind === RFID_CARD) return { id: needBytes(String(o.fields.id), 5, 'ID'), name: o.name };
  if (o.kind === RFID_READER) return { expectedId: needBytes(String(o.fields.expected), 5, 'ID'), name: o.name };
  const blocks = blocksFromString(String(o.fields.blocks ?? ''));
  return { ...(blocks ? { blocks } : {}), writeProtected: !!o.fields.writeProtected, name: o.name };
}

export const rfidDriver: AreaDriver<RfidApi, string> = {
  area: 'rfid',
  deviceArea: 'rfid',
  events: ['area:rfid:card-read', 'area:rfid:block-written', 'area:rfid:tag-written', 'area:rfid:write-rejected', 'area:rfid:reader-saw', 'area:rfid:emulation', 'area:rfid:carrier'],
  sig: (o) => JSON.stringify([o.kind, o.fields]),
  // objects live in the C world of one program: nothing is left over, but an empty world is made sure of
  wipe: (api) => {
    if (api.list().length) api.reset();
  },
  create(api, o, _c, st) {
    const s = spec(o);
    const key = (o.kind === RFID_CARD ? api.createCard(s) : o.kind === RFID_TAG ? api.createTag(s) : api.createReader(s)).key;
    st.byHw.set(key, o.id);
    if (o.near) api.bringNear(key);
    return key;
  },
  update(api, key, o) {
    const s = spec(o);
    if (o.kind === RFID_TAG) {
      // the blocks are the Dot's to change after creation; only the protection comes from the bench
      delete s.blocks;
    }
    api.update(key, s);
    if (api.isNear(key) !== o.near) (o.near ? api.bringNear(key) : api.takeAway(key));
  },
  remove(api, key, _o, _c, st) {
    st.byHw.delete(key);
    api.remove(key);
  },
  onEvent(name, d, api, ctx, st) {
    const type = name.slice('area:rfid:'.length);
    if (type === 'emulation') return ctx.live.setData('area:rfid', { emulating: !!d.active, emulatedId: d.active && d.decodes ? d.id : null });
    if (type === 'carrier') return ctx.live.setData('area:rfid', { carrier: !!d.on });
    const id = d.key ? st.byHw.get(d.key) : undefined;
    if (type === 'write-rejected') {
      const target = id ?? [...st.byHw.values()][0];
      if (target) ctx.say(target, 'live.rfid.rejected', 'bad', { why: String(d.reason) });
      return;
    }
    if (!id) return;
    if (type === 'card-read') {
      ctx.live.setData(id, { lastId: d.id });
      ctx.say(id, 'live.rfid.read', 'ok', { id: String(d.id) });
    } else if (type === 'block-written' || type === 'tag-written') {
      const snap = api?.get(d.key);
      if (snap?.blocks) ctx.report(id, { blocks: blocksToString(snap.blocks) });
      ctx.live.setData(id, { tagId: snap?.id ?? null, blocks: snap?.blocks ?? null });
      if (type === 'tag-written') ctx.say(id, 'live.rfid.written', 'ok', { id: String(d.id) });
    } else if (type === 'reader-saw') {
      ctx.live.setData(id, { visible: !!d.visible, presented: d.id, match: !!d.match, count: d.count });
      if (d.visible) ctx.say(id, d.match ? 'live.rfid.granted' : 'live.rfid.denied', d.match ? 'ok' : 'bad', { id: String(d.id) });
    }
  },
  poll(api, objects, ctx, st) {
    // what a rewritable tag reads back as (it changes when the Dot programs it)
    for (const o of objects) {
      if (o.kind !== RFID_TAG) continue;
      const key = [...st.byHw].find(([, id]) => id === o.id)?.[0];
      if (key !== undefined) ctx.live.setData(o.id, { tagId: api.get(String(key)).id ?? null });
    }
  },
  gone(ctx) {
    ctx.live.clear('area:rfid');
  },
};
