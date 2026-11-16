import type { TKey } from '../i18n/core';
import type { AreaKey, KodeDevice } from '../device/types';

/** Every bench area of the design table. */
export type AreaId = 'nfc' | 'rfid' | 'wifi' | 'ble' | 'ir' | 'sd' | 'usb' | 'power' | 'motion';

export type FieldValue = string | number | boolean;

export type FieldDef =
  | { key: string; labelKey: TKey; type: 'text'; placeholder?: string }
  | { key: string; labelKey: TKey; type: 'range'; min: number; max: number; step: number; unit?: string }
  | { key: string; labelKey: TKey; type: 'number'; min?: number; max?: number; step?: number }
  | { key: string; labelKey: TKey; type: 'toggle' }
  | { key: string; labelKey: TKey; type: 'select'; options: { value: string; label: string }[] };

export interface ActionDef {
  key: string;
  labelKey: TKey;
}

/** What the store needs to know about a kind of object; UI and device hooks hang off it too. */
export interface KindDef {
  key: string; // e.g. 'motion.pose'
  area: AreaId;
  labelKey: TKey;
  descKey: TKey;
  fields: FieldDef[];
  defaults: Record<string, FieldValue>;
  actions?: ActionDef[];
  /** Push the area's state to the device: `active` is the object in the area's slot, or null. */
  sync?(device: KodeDevice, active: BenchObject | null): void;
  /** Run a named action (button) on an object. */
  run?(device: KodeDevice, obj: BenchObject, action: string): void;
}

export interface BenchObject {
  id: string;
  area: AreaId;
  kind: string;
  name: string;
  fields: Record<string, FieldValue>;
}

export interface AreaDef {
  id: AreaId;
  labelKey: TKey;
  /** Radio-type areas use a "near the device" slot. */
  radio: boolean;
  /** Stage of the design (docs/superpowers/specs) that delivers the real objects. */
  stage: number;
  /** Planned objects, from the design table. */
  plannedKey: TKey;
  slotKey: TKey;
  verbs: { on: TKey; off: TKey };
  /** Key in HardwareAreas when the device implements it. */
  deviceArea?: AreaKey;
}

const NEAR = { on: 'verb.near', off: 'verb.away' } as const;

export const AREAS: AreaDef[] = [
  { id: 'nfc', labelKey: 'area.nfc', radio: true, stage: 2, plannedKey: 'area.nfc.planned', slotKey: 'slot.near', verbs: NEAR },
  { id: 'rfid', labelKey: 'area.rfid', radio: true, stage: 2, plannedKey: 'area.rfid.planned', slotKey: 'slot.near', verbs: NEAR },
  { id: 'wifi', labelKey: 'area.wifi', radio: true, stage: 3, plannedKey: 'area.wifi.planned', slotKey: 'slot.range', verbs: NEAR },
  { id: 'ble', labelKey: 'area.ble', radio: true, stage: 3, plannedKey: 'area.ble.planned', slotKey: 'slot.range', verbs: NEAR },
  { id: 'ir', labelKey: 'area.ir', radio: true, stage: 4, plannedKey: 'area.ir.planned', slotKey: 'slot.sightline', verbs: NEAR },
  { id: 'sd', labelKey: 'area.sd', radio: false, stage: 4, plannedKey: 'area.sd.planned', slotKey: 'slot.inSlot', verbs: { on: 'verb.insert', off: 'verb.remove' } },
  { id: 'usb', labelKey: 'area.usb', radio: false, stage: 4, plannedKey: 'area.usb.planned', slotKey: 'slot.connected', verbs: { on: 'verb.connect', off: 'verb.disconnect' } },
  { id: 'power', labelKey: 'area.power', radio: false, stage: 4, plannedKey: 'area.power.planned', slotKey: 'slot.connected', verbs: { on: 'verb.connect', off: 'verb.disconnect' } },
  { id: 'motion', labelKey: 'area.motion', radio: false, stage: 4, plannedKey: 'area.motion.planned', slotKey: 'slot.inUse', verbs: { on: 'verb.activate', off: 'verb.deactivate' }, deviceArea: 'motion' },
];

export const getArea = (id: AreaId): AreaDef => AREAS.find((a) => a.id === id)!;
