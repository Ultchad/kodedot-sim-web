/**
 * Bluetooth bench objects (docs/STATUS-ble.md "Bench-object API"): a sensor that advertises a temperature and its
 * battery, and a phone that scans, connects and pairs with the Dot. The glue keeps the objects; this driver makes it
 * equal to the bench.
 */
import type { BenchObject, KindDef } from '../model';
import type { AreaDriver } from './types';
import { errorText } from './types';

export const BLE_SENSOR = 'ble.sensor';
export const BLE_PHONE = 'ble.phone';

export const bleKinds: KindDef[] = [
  {
    key: BLE_SENSOR,
    area: 'ble',
    labelKey: 'kind.ble.sensor',
    descKey: 'kind.ble.sensor.desc',
    addKey: 'kind.ble.sensor.add',
    fields: [
      { key: 'name', labelKey: 'field.bleName', type: 'text' },
      { key: 'temperature', labelKey: 'field.temperature', type: 'range', min: -20, max: 60, step: 0.5, unit: ' °C' },
      { key: 'battery', labelKey: 'field.charge', type: 'range', min: 0, max: 100, step: 1, unit: ' %' },
    ],
    defaults: { name: 'Sensor', temperature: 21.5, battery: 90 },
    unique: (n) => ({ name: `Sensor ${n}` }),
  },
  {
    key: BLE_PHONE,
    area: 'ble',
    labelKey: 'kind.ble.phone',
    descKey: 'kind.ble.phone.desc',
    addKey: 'kind.ble.phone.add',
    fields: [
      { key: 'name', labelKey: 'field.bleName', type: 'text' },
      {
        key: 'pairing',
        labelKey: 'field.pairing',
        type: 'select',
        options: [
          { value: 'ask', labelKey: 'opt.pairAsk' },
          { value: 'auto', labelKey: 'opt.pairAuto' },
        ],
      },
    ],
    defaults: { name: 'Phone', pairing: 'ask' },
    unique: (n) => ({ name: `Phone ${n}` }),
  },
];

interface Sensor {
  update(patch: object): void;
  setValue(degC: number): void;
  setBattery(pct: number): void;
  remove(): void;
}
export interface BlePhone {
  scan(ms?: number): Promise<{ sees: boolean; name?: string; rssi?: number; discoverable?: boolean; bonded?: boolean }>;
  connect(o?: { wait?: number }): Promise<{ ok: boolean; reason?: string }>;
  pair(o?: { passkey?: number }): Promise<{ ok: boolean; status?: string; authenticated?: boolean }>;
  enterPasskey?(n: number): void;
  cancelPairing(): void;
  disconnect(): void;
  forget(): void;
  update?(patch: object): void;
  remove?(): void;
  secure: boolean;
  bonded: boolean;
  connected: boolean;
  console: { send(line: string): void; lines: string[] };
}
interface BleApi {
  addSensor(o: object): Sensor;
  addPhone(o: object): BlePhone;
  clear(): void;
  state(): { passkey?: number | string | null; stack?: string; adv?: unknown };
  lastPasskey(): number | string | null;
  remove?(id: unknown): void;
}

const sensorOpts = (o: BenchObject) => ({ name: String(o.fields.name ?? 'Sensor'), inRange: o.near, temperature: Number(o.fields.temperature ?? 21.5), battery: Number(o.fields.battery ?? 90) });
const phoneOpts = (o: BenchObject) => ({ name: String(o.fields.name ?? 'Phone'), inRange: o.near, io: 'keyboard', pairing: o.fields.pairing === 'auto' ? 'auto' : 'ask' });

export const bleDriver: AreaDriver<BleApi, Sensor | BlePhone> = {
  area: 'ble',
  deviceArea: 'ble',
  events: [],
  sig: (o) => JSON.stringify([o.kind, o.fields]),
  wipe(api) {
    api.clear();
  },
  create(api, o, ctx) {
    try {
      return o.kind === BLE_SENSOR ? api.addSensor(sensorOpts(o)) : api.addPhone(phoneOpts(o));
    } catch (e) {
      ctx.say(o.id, 'ble.failed', 'bad', { reason: errorText(e) });
      throw e;
    }
  },
  update(_api, h, o) {
    if (o.kind === BLE_SENSOR) {
      const s = h as Sensor;
      s.update({ name: String(o.fields.name ?? 'Sensor'), inRange: o.near });
      s.setValue(Number(o.fields.temperature ?? 21.5));
      s.setBattery(Number(o.fields.battery ?? 90));
    } else (h as BlePhone).update?.({ name: String(o.fields.name ?? 'Phone'), inRange: o.near, pairing: o.fields.pairing === 'auto' ? 'auto' : 'ask' });
  },
  remove(_api, h) {
    try {
      (h as Sensor).remove?.();
    } catch {
      /* the program that held it is gone */
    }
  },
  poll(api, objects, ctx, st) {
    let passkey: number | string | null = null;
    try {
      passkey = api.state().passkey ?? api.lastPasskey() ?? null;
    } catch {
      /* not up yet */
    }
    for (const o of objects) {
      if (o.kind !== BLE_PHONE) continue;
      const p = st.handles.get(o.id) as BlePhone | undefined;
      if (p) ctx.live.setData(o.id, { connected: !!p.connected, secure: !!p.secure, bonded: !!p.bonded, passkey });
    }
  },
};
