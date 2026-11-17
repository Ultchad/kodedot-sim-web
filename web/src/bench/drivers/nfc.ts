import type { BenchObject, KindDef } from '../model';
import { hexBytes, needBytes, randomHex } from './util';
import type { AreaDriver, DriverCtx, DriverState } from './types';

export const NFC_TAG = 'nfc.tag';
export const NFC_CARD = 'nfc.card';
export const NFC_READER = 'nfc.reader';

export const nfcKinds: KindDef[] = [
  {
    key: NFC_TAG,
    area: 'nfc',
    labelKey: 'kind.nfc.tag',
    descKey: 'kind.nfc.tag.desc',
    addKey: 'kind.nfc.tag.add',
    fields: [
      {
        key: 'mode',
        labelKey: 'field.holds',
        type: 'select',
        options: [
          { value: 'text', labelKey: 'opt.text' },
          { value: 'link', labelKey: 'opt.link' },
        ],
      },
      { key: 'text', labelKey: 'field.text', type: 'text', when: (f) => f.mode !== 'link' },
      { key: 'uri', labelKey: 'field.link', type: 'text', placeholder: 'https://', when: (f) => f.mode === 'link' },
      { key: 'locked', labelKey: 'field.readOnly', type: 'toggle' },
      { key: 'uid', labelKey: 'field.uid', type: 'text', mono: true },
    ],
    defaults: { mode: 'text', text: 'Hello from the bench', uri: 'https://kode.diy', locked: false, uid: '04:11:22:33:44:55:66' },
    unique: () => ({ uid: randomHex(7, [0x04]) }),
  },
  {
    key: NFC_CARD,
    area: 'nfc',
    labelKey: 'kind.nfc.card',
    descKey: 'kind.nfc.card.desc',
    addKey: 'kind.nfc.card.add',
    fields: [
      {
        key: 'type',
        labelKey: 'field.cardType',
        type: 'select',
        options: [
          { value: 'mifare1k', labelKey: 'opt.mifare' },
          { value: 'iso-dep', labelKey: 'opt.isodep' },
          { value: 'other', labelKey: 'opt.otherCard' },
        ],
      },
      { key: 'uid', labelKey: 'field.uid', type: 'text', mono: true },
    ],
    defaults: { type: 'mifare1k', uid: 'DE:AD:BE:EF' },
    unique: () => ({ uid: randomHex(4, [0xde]) }),
  },
  {
    key: NFC_READER,
    area: 'nfc',
    labelKey: 'kind.nfc.reader',
    descKey: 'kind.nfc.reader.desc',
    addKey: 'kind.nfc.reader.add',
    fields: [],
    defaults: {},
  },
];

const uidLen = (type: string): number | number[] => (type === 'iso-dep' ? [4, 7, 10] : 4);

export function tagSpec(o: BenchObject): { uid: string; memory: string; locked: boolean; uri?: string; text?: string; lang?: string } {
  const f = o.fields;
  const uid = needBytes(String(f.uid ?? ''), 7, 'UID');
  return { uid, memory: 'ntag215', locked: !!f.locked, ...(f.mode === 'link' ? { uri: String(f.uri ?? '') } : { text: String(f.text ?? ''), lang: 'en' }) };
}
export function cardSpec(o: BenchObject) {
  const type = String(o.fields.type ?? 'mifare1k');
  const uid = needBytes(String(o.fields.uid ?? ''), uidLen(type), 'UID');
  return type === 'iso-dep' ? { type: 'iso-dep', uid } : type === 'other' ? { type: 'unsupported', uid } : { type: 'mifare1k', uid, blank: true };
}

interface NfcHandle {
  id: number;
  info(): { near: boolean; locked: boolean; uid: string } | null;
  near(): unknown;
  away(): unknown;
  remove(): unknown;
  update(p: Record<string, unknown>): unknown;
  seen?(): { uid: string | null; sessions: number; text?: string; uri?: string; pages: number[] } | null;
  __cfg?: string;
}
interface NfcApi {
  tag(s: object): NfcHandle;
  card(s: object): NfcHandle;
  reader(s: object): NfcHandle;
  objects(): NfcHandle[];
  reset(): void;
}

const cfgOf = (o: BenchObject) => `${o.fields.type}|${String(o.fields.uid).toUpperCase()}`;

function make(api: NfcApi, o: BenchObject, st: DriverState): NfcHandle {
  const h = o.kind === NFC_TAG ? api.tag(tagSpec(o)) : o.kind === NFC_CARD ? api.card(cardSpec(o)) : api.reader({});
  h.__cfg = cfgOf(o);
  st.byHw.set(h.id, o.id);
  if (o.near) h.near();
  return h;
}

export const nfcDriver: AreaDriver<NfcApi, NfcHandle> = {
  area: 'nfc',
  deviceArea: 'nfc',
  events: ['area:nfc:read', 'area:nfc:written', 'area:nfc:activated', 'area:nfc:lost', 'area:nfc:dropped', 'area:nfc:reader-saw', 'area:nfc:field', 'area:nfc:emulation'],
  sig: (o) => JSON.stringify([o.kind, o.fields]),
  // the NFC area keeps its objects in a persistent region: a new program finds the old ones
  wipe: (api) => api.reset(),
  create: (api, o, _ctx, st) => make(api, o, st),
  update(api, h, o, _ctx, st) {
    if (o.kind === NFC_CARD && h.__cfg !== cfgOf(o)) {
      const spec = cardSpec(o); // throws before anything is removed
      st.byHw.delete(h.id);
      h.remove();
      void spec;
      return make(api, o, st);
    }
    if (o.kind === NFC_TAG) {
      const s = tagSpec(o);
      const info = h.info();
      const patch: Record<string, unknown> = s.uri !== undefined ? { uri: s.uri } : { text: s.text, lang: 'en' };
      if (info && info.uid !== s.uid) patch.uid = s.uid;
      if (info && info.locked !== s.locked) patch.locked = s.locked;
      h.update(patch);
    }
    const info = h.info();
    if (info && info.near !== o.near) (o.near ? h.near() : h.away());
  },
  remove(_api, h, _o, _c, st) {
    st.byHw.delete(h.id);
    h.remove();
  },
  onEvent(name, d, api, ctx: DriverCtx, st) {
    const type = name.slice('area:nfc:'.length);
    if (type === 'field') return ctx.live.setData('area:nfc', { field: !!d.on });
    if (type === 'emulation') return ctx.live.setData('area:nfc', { emulating: !!d.started });
    const id = st.byHw.get(d.id);
    if (!id) return;
    const o = ctx.get(id);
    if (!o) return;
    if (type === 'read') {
      ctx.live.setData(id, { reads: d.reads });
      ctx.say(id, 'live.nfc.read', 'ok');
    } else if (type === 'activated') ctx.say(id, 'live.nfc.found', 'ok');
    else if (type === 'lost') ctx.say(id, 'live.nfc.lost', 'bad');
    else if (type === 'dropped') ctx.say(id, 'live.nfc.dropped', 'info');
    else if (type === 'written') {
      const c = d.content as { text?: string; uri?: string } | undefined;
      const what = c?.uri ?? c?.text ?? '';
      if (o.kind === NFC_TAG && c) {
        if (c.uri !== undefined && c.text === undefined) ctx.report(id, { mode: 'link', uri: c.uri });
        else if (c.text !== undefined) ctx.report(id, { mode: 'text', text: c.text });
      }
      ctx.say(id, what ? 'live.nfc.written' : 'live.nfc.writtenEmpty', 'ok', { what });
    } else if (type === 'reader-saw') {
      const seen = d.seen as { uid: string | null; text?: string; uri?: string; sessions: number } | null;
      ctx.live.setData(id, { seen });
      ctx.say(id, 'live.nfc.readerSaw', 'ok', { uid: seen?.uid ?? '?' });
    }
    void api;
  },
  gone(ctx) {
    ctx.live.clear('area:nfc');
  },
};

export { hexBytes };
