import type { TKey } from '../i18n/core';

/** Every bench area of the design table. */
export type AreaId = 'nfc' | 'rfid' | 'wifi' | 'ble' | 'ir' | 'sd' | 'usb' | 'power' | 'motion';

export type FieldValue = string | number | boolean;

export type FieldDef =
  | { key: string; labelKey: TKey; type: 'text'; placeholder?: string; mono?: boolean; /** hidden unless this predicate holds for the object's fields */ when?: (f: Record<string, FieldValue>) => boolean }
  | { key: string; labelKey: TKey; type: 'range'; min: number; max: number; step: number; unit?: string; when?: (f: Record<string, FieldValue>) => boolean }
  | { key: string; labelKey: TKey; type: 'number'; min?: number; max?: number; step?: number; when?: (f: Record<string, FieldValue>) => boolean }
  | { key: string; labelKey: TKey; type: 'toggle'; when?: (f: Record<string, FieldValue>) => boolean }
  | { key: string; labelKey: TKey; type: 'select'; options: { value: string; label?: string; labelKey?: TKey }[]; when?: (f: Record<string, FieldValue>) => boolean };

export interface ActionDef {
  key: string;
  labelKey: TKey;
}

/** How "near" reads for a kind: the switch shows the current state, in the area's own words. */
export interface Presence {
  on: TKey;
  off: TKey;
}

/** What the store and the UI need to know about a kind of object. Device behaviour lives in the area's driver (bench/drivers). */
export interface KindDef {
  key: string; // e.g. 'nfc.tag'
  area: AreaId;
  labelKey: TKey;
  descKey: TKey;
  /** Label of the "add" button, when "Add: {kind}" does not read well. */
  addKey?: TKey;
  fields: FieldDef[];
  defaults: Record<string, FieldValue>;
  /** Fields that must be different on every object (a UID, a network name): given the ordinal of the new object. */
  unique?(n: number): Record<string, FieldValue>;
  actions?: ActionDef[];
  /** 'none': the object has no near/away control (it simply exists). Default 'near'. */
  presence?: 'none' | Presence;
  /** One object of this kind at most (a battery, a charger). */
  single?: boolean;
  /** Run a named action (button) on an object. */
  run?(ctx: { device: import('../device/types').KodeDevice }, obj: BenchObject, action: string): void;
}

export interface BenchObject {
  id: string;
  area: AreaId;
  kind: string;
  name: string;
  fields: Record<string, FieldValue>;
  /** Near the Dot / in range / pointing at it / plugged in. Kept between visits. */
  near: boolean;
  /** Where it stands on the table (mm, the Dot at the origin; workbench/layout.ts) and its quarter turns. For kinds with a range, `near` is what this position means. */
  pos: { x: number; z: number };
  rot: 0 | 1 | 2 | 3;
}

export interface AreaDef {
  id: AreaId;
  labelKey: TKey;
  /** Planned objects, for the "Coming soon" list. */
  plannedKey: TKey;
  /** Default wording of the near/away switch. */
  presence: Presence;
  /** Only one object of the area can be near at a time (the Dot has one body to tilt). */
  exclusive?: boolean;
  /** The area draws its own panel instead of a list of objects (the microSD card belongs to the Dot, not to the bench). */
  custom?: boolean;
}

const NEAR: Presence = { on: 'presence.near', off: 'presence.away' };

export const AREAS: AreaDef[] = [
  { id: 'nfc', labelKey: 'area.nfc', plannedKey: 'area.nfc.planned', presence: NEAR },
  { id: 'rfid', labelKey: 'area.rfid', plannedKey: 'area.rfid.planned', presence: NEAR },
  { id: 'wifi', labelKey: 'area.wifi', plannedKey: 'area.wifi.planned', presence: { on: 'presence.inRange', off: 'presence.outOfRange' } },
  { id: 'ble', labelKey: 'area.ble', plannedKey: 'area.ble.planned', presence: { on: 'presence.inRange', off: 'presence.outOfRange' } },
  { id: 'ir', labelKey: 'area.ir', plannedKey: 'area.ir.planned', presence: { on: 'presence.aimed', off: 'presence.notAimed' } },
  { id: 'sd', labelKey: 'area.sd', plannedKey: 'area.sd.planned', presence: { on: 'presence.inSlot', off: 'presence.ejected' }, custom: true },
  { id: 'usb', labelKey: 'area.usb', plannedKey: 'area.usb.planned', presence: { on: 'presence.connected', off: 'presence.disconnected' } },
  { id: 'power', labelKey: 'area.power', plannedKey: 'area.power.planned', presence: { on: 'presence.plugged', off: 'presence.unplugged' } },
  { id: 'motion', labelKey: 'area.motion', plannedKey: 'area.motion.planned', presence: { on: 'presence.inUse', off: 'presence.notInUse' }, exclusive: true },
];

export const getArea = (id: AreaId): AreaDef => AREAS.find((a) => a.id === id)!;
