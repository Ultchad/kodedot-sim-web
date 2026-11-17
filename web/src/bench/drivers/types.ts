import type { AreaId, BenchObject, FieldValue } from '../model';
import type { LiveStore } from '../live';
import type { TKey, Vars } from '../../i18n/core';

/** What a driver may do besides calling the device. */
export interface DriverCtx {
  live: LiveStore;
  /** Something the Dot changed in an object (the text it wrote to a tag): kept in the bench, and not pushed back to the Dot. */
  report(id: string, fields: Record<string, FieldValue>): void;
  /** A line in the object's feedback. */
  say(id: string, key: TKey, tone?: 'info' | 'ok' | 'bad', vars?: Vars): void;
  /** The bench object with this id. */
  get(id: string): BenchObject | undefined;
  /** The objects of an area that are near. */
  nearIn(area: AreaId): BenchObject[];
  now(): number;
}

/** Per-area book-keeping that belongs to one device area instance (one running program). */
export interface DriverState {
  /** The device area object these handles belong to: a new program has a new one and starts from nothing. */
  api: unknown;
  /** Bench object id -> whatever the driver made for it in the device. */
  handles: Map<string, unknown>;
  /** Bench object id -> signature of what was last pushed. */
  applied: Map<string, string>;
  /** Free space for the driver (hardware id -> bench id). */
  byHw: Map<string | number, string>;
}

/**
 * One hardware area's bridge between bench objects and the device's area glue. The runtime calls these; a driver never
 * keeps its own list of objects, so a new program (new glue, maybe with leftovers) can never end up with duplicates.
 */
export interface AreaDriver<Api = any, Handle = any> {
  area: AreaId;
  /** Key in `device.areas`. */
  deviceArea: string;
  /** Full event names, e.g. `area:nfc:read`. */
  events: readonly string[];
  /** What of the object is pushed to the device (the runtime adds `near`). A change means `update` runs. */
  sig(obj: BenchObject): string;
  /** A fresh area instance: remove what an earlier program left in it. */
  wipe?(api: Api, st: DriverState): void;
  create(api: Api, obj: BenchObject, ctx: DriverCtx, st: DriverState): Handle;
  /** Returns a new handle when the object had to be rebuilt. */
  update(api: Api, handle: Handle, obj: BenchObject, ctx: DriverCtx, st: DriverState): Handle | void;
  remove(api: Api, handle: Handle, obj: BenchObject | undefined, ctx: DriverCtx, st: DriverState): void;
  onEvent?(name: string, data: any, api: Api | undefined, ctx: DriverCtx, st: DriverState): void;
  /** About twice a second while the Dot runs: live state that has no event. */
  poll?(api: Api, objects: BenchObject[], ctx: DriverCtx, st: DriverState): void;
  /** The Dot went away or the program changed: drop live state. */
  gone?(ctx: DriverCtx, st: DriverState): void;
}

export const errorText = (e: unknown): string => String((e as Error)?.message ?? e);
