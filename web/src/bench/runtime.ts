import type { KodeDevice } from '../device/types';
import type { FieldValue } from './model';
import { LiveStore } from './live';
import type { BenchStore } from './store';
import { getKind } from './kinds';
import { errorText, type AreaDriver, type DriverCtx, type DriverState } from './drivers/types';

/** The part of a real device the runtime listens to; the mock has none of it. */
export type EventfulDevice = KodeDevice & {
  onEvent(name: string, cb: (data: unknown) => void): () => void;
  readonly program: { subscribe(l: (v: never) => void): () => void };
};
const isEventful = (d: KodeDevice): d is EventfulDevice => typeof (d as Partial<EventfulDevice>).onEvent === 'function';

const POLL_MS = 500;

/**
 * Keeps the Dot's world equal to the bench. The bench (the page) is the truth; the device's area glue is rebuilt from it
 * whenever a program starts, so an object left near the Dot survives kodeOS -> app -> kodeOS, and objects an area keeps
 * by itself (NFC, IR) or that survive in a cached glue module (Wi-Fi routers) are wiped first: never a duplicate.
 */
export class BenchRuntime {
  private states = new Map<string, DriverState>();
  private failed = new Map<string, string>();
  private device: KodeDevice | null = null;
  private offs: (() => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private syncing = false;
  private again = false;

  readonly ctx: DriverCtx;

  constructor(
    private bench: BenchStore,
    readonly live: LiveStore,
    private drivers: readonly AreaDriver[],
    now: () => number = () => Date.now(),
  ) {
    this.ctx = {
      live,
      now,
      get: (id) => bench.get(id),
      nearIn: (a) => bench.nearIn(a),
      say: (id, key, tone, vars) => live.push(id, { key, tone, vars }),
      report: (id, fields) => this.report(id, fields),
    };
  }

  /** Starts following a device (and stops following the previous one). */
  attach(device: KodeDevice): () => void {
    this.detach();
    this.device = device;
    this.offs.push(this.bench.subscribe(() => this.sync()));
    if (isEventful(device)) {
      this.offs.push(device.program.subscribe(() => this.sync()), device.status.subscribe(() => this.sync()));
      for (const d of this.drivers) {
        for (const name of d.events) {
          this.offs.push(
            device.onEvent(name, (data) => {
              try {
                d.onEvent?.(name, data, this.api(d), this.ctx, this.state(d));
              } catch (e) {
                console.error('bench event', name, e);
              }
            }),
          );
        }
      }
    }
    this.timer = setInterval(() => this.tick(), POLL_MS);
    this.sync();
    return () => this.detach();
  }

  detach(): void {
    for (const o of this.offs) o();
    this.offs = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.states.clear();
    this.failed.clear();
    this.device = null;
  }

  /** The device-side handle a driver made for a bench object (a remote to press, a router to ask), or null. */
  handle<T = unknown>(id: string): T | null {
    for (const st of this.states.values()) if (st.handles.has(id)) return st.handles.get(id) as T;
    return null;
  }

  private state(d: AreaDriver): DriverState {
    let st = this.states.get(d.area);
    if (!st) this.states.set(d.area, (st = { api: undefined, handles: new Map(), applied: new Map(), byHw: new Map() }));
    return st;
  }
  private api(d: AreaDriver): unknown {
    const areas = this.device?.areas as Record<string, unknown> | undefined;
    return areas?.[d.deviceArea] ?? undefined;
  }

  private sigOf(d: AreaDriver, o: { near: boolean }, obj: Parameters<AreaDriver['sig']>[0]): string {
    return `${o.near ? 1 : 0}|${d.sig(obj)}`;
  }

  /** The Dot changed an object: keep it, mark it as already applied. */
  private report(id: string, fields: Record<string, FieldValue>): void {
    const obj = this.bench.get(id);
    if (!obj) return;
    const d = this.drivers.find((x) => x.area === obj.area);
    if (d) {
      const next = { ...obj, fields: { ...obj.fields, ...fields } };
      this.state(d).applied.set(id, this.sigOf(d, next, next));
    }
    this.bench.setFields(id, fields);
  }

  /** Makes the device match the bench. Idempotent; cheap when nothing changed. */
  sync(): void {
    if (!this.device) return;
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.again = false;
        for (const d of this.drivers) this.syncArea(d);
        this.live.prune(new Set(this.bench.getState().objects.map((o) => o.id)));
      } while (this.again);
    } finally {
      this.syncing = false;
    }
  }

  private syncArea(d: AreaDriver): void {
    const st = this.state(d);
    const api = this.api(d);
    if (!api) {
      if (st.api) {
        st.api = undefined;
        st.handles.clear();
        st.applied.clear();
        st.byHw.clear();
        this.failed.clear();
        d.gone?.(this.ctx, st);
      }
      return;
    }
    if (st.api !== api) {
      if (st.api) d.gone?.(this.ctx, st);
      st.api = api;
      st.handles.clear();
      st.applied.clear();
      st.byHw.clear();
      this.failed.clear();
      try {
        d.wipe?.(api, st);
      } catch (e) {
        console.error('bench wipe', d.area, e);
      }
    }
    const objects = this.bench.getState().objects.filter((o) => o.area === d.area && getKind(o.kind));
    const ids = new Set(objects.map((o) => o.id));
    for (const [id, h] of [...st.handles]) {
      if (ids.has(id)) continue;
      st.handles.delete(id);
      st.applied.delete(id);
      try {
        d.remove(api, h, undefined, this.ctx, st);
      } catch (e) {
        console.error('bench remove', d.area, e);
      }
    }
    for (const obj of objects) {
      const sig = this.sigOf(d, obj, obj);
      if (st.applied.get(obj.id) === sig || this.failed.get(obj.id) === sig) continue;
      try {
        const have = st.handles.get(obj.id);
        if (have === undefined) st.handles.set(obj.id, d.create(api, obj, this.ctx, st));
        else {
          const next = d.update(api, have, obj, this.ctx, st);
          if (next !== undefined) st.handles.set(obj.id, next);
        }
        st.applied.set(obj.id, sig);
        this.failed.delete(obj.id);
      } catch (e) {
        this.failed.set(obj.id, sig);
        this.ctx.say(obj.id, 'live.error', 'bad', { why: errorText(e) });
      }
    }
  }

  private tick(): void {
    if (!this.device) return;
    this.sync(); // catches a program that started without the page being told
    for (const d of this.drivers) {
      const api = this.api(d);
      if (!api || !d.poll) continue;
      try {
        d.poll(api, this.bench.getState().objects.filter((o) => o.area === d.area), this.ctx, this.state(d));
      } catch (e) {
        console.error('bench poll', d.area, e);
      }
    }
  }
}
