import type { BenchObject, KindDef } from '../model';
import type { AreaDriver } from './types';

export const POWER_CHARGER = 'power.charger';
export const POWER_BATTERY = 'power.battery';

export const powerKinds: KindDef[] = [
  {
    key: POWER_CHARGER,
    area: 'power',
    labelKey: 'kind.power.charger',
    descKey: 'kind.power.charger.desc',
    addKey: 'kind.power.charger.add',
    single: true,
    fields: [
      {
        key: 'cable',
        labelKey: 'field.cable',
        type: 'select',
        options: [
          { value: 'usb', labelKey: 'opt.usbPort' },
          { value: 'adapter', labelKey: 'opt.wallAdapter' },
        ],
      },
    ],
    defaults: { cable: 'usb' },
    presence: { on: 'presence.plugged', off: 'presence.unplugged' },
  },
  {
    key: POWER_BATTERY,
    area: 'power',
    labelKey: 'kind.power.battery',
    descKey: 'kind.power.battery.desc',
    addKey: 'kind.power.battery.add',
    single: true,
    fields: [{ key: 'level', labelKey: 'field.charge', type: 'range', min: 0, max: 100, step: 1, unit: ' %' }],
    defaults: { level: 80 },
    presence: 'none',
  },
];

interface PowerApi {
  plug(on: boolean, kind?: string): void;
  setLevel(pct: number): void;
  level(): number;
  voltage(): number;
  charging(): string;
  cable(): string;
  currentMa(): number;
}

function apply(api: PowerApi, o: BenchObject): void {
  if (o.kind === POWER_BATTERY) api.setLevel(Number(o.fields.level ?? 80));
  else api.plug(o.near, String(o.fields.cable ?? 'usb'));
}

export const powerDriver: AreaDriver<PowerApi, string> = {
  area: 'power',
  deviceArea: 'power',
  events: [],
  sig: (o) => JSON.stringify([o.kind, o.fields]),
  create(api, o) {
    apply(api, o);
    return o.kind;
  },
  update(api, _h, o) {
    apply(api, o);
  },
  remove(api, kind) {
    // the cable of a charger taken off the bench comes out; a battery that goes leaves the cell as it is
    if (kind === POWER_CHARGER) api.plug(false);
  },
  poll(api, objects, ctx) {
    for (const o of objects) {
      if (o.kind === POWER_BATTERY) ctx.live.setData(o.id, { level: Math.round(api.level()), mv: api.voltage(), phase: api.charging(), ma: api.currentMa() });
      else ctx.live.setData(o.id, { phase: api.charging(), cable: api.cable() });
    }
  },
};
