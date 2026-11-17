import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MOTION_KIND, poseOf } from '../bench/drivers/motion';
import { KINDS, getKind, kindsOf } from '../bench/kinds';
import { AREAS, getArea, type BenchObject, type KindDef } from '../bench/model';
import type { SdAreaApi } from '../bench/sd';
import { useBenchState } from '../state/bench';
import { useI18n } from '../i18n';
import { isPhone } from '../lib/layout';
import { ZERO_POSE } from '../lib/pose';
import { useHost } from '../state/host';
import { DOT_ID, SD_ID, hasBody, zoneOf } from '../workbench/layout';
import { KIND_MIME, type Selection } from '../workbench/state';
import { Icon, IconTile } from './Glyphs';
import { ScrollArea, useCoarsePointer } from './ui';
import { ObjectCard } from './bench/ObjectCard';
import { SdPanel } from './bench/SdPanel';

/** `compact`: the tab row right above already names the section (phone sheet), so the title is kept for screen readers only. */
export function SectionTitle({ title, subtitle, compact = false }: { title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className={compact ? 'sr-only' : 'text-[24px] leading-tight'}>{title}</h2>
      <p className="m-0 text-[14px] leading-snug text-ink2">{subtitle}</p>
    </div>
  );
}

const useSelection = (sel: Selection): ReadonlySet<string> => useSyncExternalStore(sel.subscribe, sel.get);

/** Whether the Dot's card slot holds the card (null: no slot to ask, the Dot is off). */
function useCardInserted(): { inserted: boolean | null; toggle(): void } {
  const { device, program } = useHost();
  const [inserted, setInserted] = useState<boolean | null>(null);
  const read = useCallback(() => {
    const sd = (device.areas as Record<string, unknown>).sd as SdAreaApi | undefined;
    try {
      setInserted(sd ? !!sd.state().inserted : null);
    } catch {
      setInserted(null);
    }
  }, [device]);
  useEffect(() => {
    read();
    const id = setInterval(read, 700);
    return () => clearInterval(id);
  }, [read, program]);
  /** Puts the card in or takes it out: the opposite of what the slot holds right now (not of what was last shown). */
  const toggle = () => {
    const sd = (device.areas as Record<string, unknown>).sd as SdAreaApi | undefined;
    if (!sd) return;
    try {
      if (!sd.state().inserted) {
        sd.insert();
        sd.mount();
      } else sd.eject();
    } catch {
      /* the slot is gone: the next read says so */
    }
    read();
  };
  return { inserted, toggle };
}

/**
 * The bench: what is selected (its inspector), everything that is on the table, and what can be added. It works the
 * same with or without the 3D table on show: the list and the switches are the bench.
 */
export function BenchPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const host = useHost();
  const state = useBenchState(host.bench);
  const sel = useSelection(host.select);
  const phone = isPhone(host.layout);
  const objects = state.objects.filter((o) => getKind(o.kind) && hasBody(o.kind));
  const card = useCardInserted();
  // a selected thing that went away is no longer selected
  useEffect(() => host.select.keep((id) => id === DOT_ID || id === SD_ID || objects.some((o) => o.id === id)), [host.select, objects]);
  const scroller = useRef<HTMLDivElement>(null);
  const first = [...sel][0];
  useEffect(() => {
    if (first) scroller.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [first]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="bench-panel">
      <SectionTitle title={t('nav.bench')} subtitle={t('bench.subtitle')} compact={compact} />
      {phone && !host.glFailed && (
        <button type="button" className="btn btn-sm btn-wrap self-start" onClick={() => host.setMode(host.mode === 'workbench' ? 'device' : 'workbench')} data-testid="wb-open">
          <Icon name={host.mode === 'workbench' ? 'device' : 'table'} size={16} />
          {t(host.mode === 'workbench' ? 'wb.back' : 'wb.open')}
        </button>
      )}
      <ScrollArea innerRef={scroller} className="-mx-2 min-h-0 flex-1 px-2 py-1" label={t('nav.bench')}>
        <div className="flex flex-col gap-4">
          <Inspector objects={objects} sel={sel} card={card} />
          <TableList objects={objects} sel={sel} card={card} />
          <Palette objects={objects} />
        </div>
      </ScrollArea>
    </div>
  );
}

type Card = ReturnType<typeof useCardInserted>;

/** The details of what is selected: one object's own card, the Dot, the microSD card, or the tools for several things. */
function Inspector({ objects, sel, card }: { objects: BenchObject[]; sel: ReadonlySet<string>; card: Card }) {
  const { t } = useI18n();
  const { bench, select, mode, bus } = useHost();
  if (!sel.size) return null;
  const ids = [...sel];
  const single = ids.length === 1 ? ids[0] : null;
  const obj = single ? objects.find((o) => o.id === single) : undefined;
  const picked = objects.filter((o) => sel.has(o.id));
  const turnable = ids.filter((id) => id !== DOT_ID);
  return (
    <section className="anim-fade flex flex-col gap-2" aria-label={t('wb.selection')} data-testid="inspector">
      <div className="flex items-center gap-2">
        <h3 className="tag m-0 flex-1">{single ? t('wb.selection') : t('wb.selected', { count: ids.length })}</h3>
        {mode === 'workbench' && single && (
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => bus.send({ type: 'focus', id: single })} aria-label={t('wb.locate')} title={t('wb.locate')} data-testid="wb-locate">
            <Icon name="target" />
          </button>
        )}
        {turnable.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-icon"
            onClick={() => {
              bench.checkpoint();
              bench.rotate(turnable);
            }}
            aria-label={t('wb.rotate.hint')}
            title={t('wb.rotate.hint')}
            data-testid="wb-rotate"
          >
            <Icon name="rotate" />
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => select.clear()} aria-label={t('wb.deselect')} title={t('wb.deselect')} data-testid="wb-deselect">
          <Icon name="close" />
        </button>
      </div>
      {obj ? (
        <ul className="m-0 list-none p-0">
          <ObjectCard key={obj.id} obj={obj} />
        </ul>
      ) : single === DOT_ID ? (
        <DotCard />
      ) : single === SD_ID ? (
        <SdPanel />
      ) : (
        <div className="inner flex flex-wrap gap-2 p-3" data-testid="multi-tools">
          {picked.some((o) => zoneOf(o.kind)) && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  bench.checkpoint();
                  picked.forEach((o) => zoneOf(o.kind) && bench.setNear(o.id, true));
                }}
              >
                {t('wb.bringNear')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  bench.checkpoint();
                  picked.forEach((o) => zoneOf(o.kind) && bench.setNear(o.id, false));
                }}
              >
                {t('wb.takeAway')}
              </button>
            </>
          )}
          {picked.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                bench.checkpoint();
                bench.removeMany(picked.map((o) => o.id));
              }}
              data-testid="multi-delete"
            >
              <Icon name="trash" size={16} />
              {t('bench.delete')}
            </button>
          )}
        </div>
      )}
      {single === SD_ID && card.inserted === null && <p className="m-0 text-[13px] leading-snug text-ink2">{t('wb.sd.noSlot')}</p>}
    </section>
  );
}

const POSE_FIELDS = [
  { key: 'pitch', labelKey: 'field.pitch', min: -90, max: 90 },
  { key: 'roll', labelKey: 'field.roll', min: -180, max: 180 },
  { key: 'heading', labelKey: 'field.heading', min: 0, max: 360 },
] as const;

/** The Dot itself: how it lies (the motion sensors feel it), a shake, and this phone's own sensors. */
function DotCard() {
  const { t, fmt } = useI18n();
  const host = useHost();
  const state = useBenchState(host.bench);
  const active = state.objects.find((o) => o.near && o.kind === MOTION_KIND);
  const pose = active ? poseOf(active) : ZERO_POSE;
  const flat = pose.pitch === 0 && pose.roll === 0 && pose.heading === 0;
  return (
    <div className="inner flex flex-col gap-3 p-4" data-testid="dot-card">
      <div className="flex items-center gap-3">
        <span className="icon-tile shrink-0 bg-[var(--tile-dark)] !text-white" style={{ width: 40, height: 40 }} aria-hidden>
          <Icon name="device" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] leading-snug">{t('wb.dot.name')}</h3>
          <p className="tag m-0 mt-0.5 !text-[11px]">{t('kind.motion.pose')}</p>
        </div>
      </div>
      <p className="m-0 text-[13.5px] leading-snug text-ink2">{t('wb.dot.tilt.hint')}</p>
      <div className="flex flex-col gap-1.5">
        {POSE_FIELDS.map((f) => (
          <div key={f.key} className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_4.5rem] items-center gap-2">
            <label htmlFor={`pose-${f.key}`} className="text-[14px] font-semibold">
              {t(f.labelKey)}
            </label>
            <input
              id={`pose-${f.key}`}
              type="range"
              min={f.min}
              max={f.max}
              step={1}
              value={pose[f.key]}
              onChange={(e) => {
                host.bench.checkpoint('tilt');
                host.applyPose({ ...pose, [f.key]: Number(e.target.value) });
              }}
              data-testid={`field-${f.key}`}
            />
            <output htmlFor={`pose-${f.key}`} className="text-right text-[14px] tabular-nums text-ink2">
              {fmt.number(pose[f.key])}°
            </output>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => {
            host.device.areas.motion?.shake?.();
            host.bus.send({ type: 'shake' });
          }}
          data-testid="action-shake"
        >
          {t('action.shake')}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={flat}
          onClick={() => {
            host.bench.checkpoint('tilt');
            host.applyPose(ZERO_POSE);
          }}
          data-testid="lay-flat"
        >
          {t('wb.layFlat')}
        </button>
      </div>
      <SensorControls />
    </div>
  );
}

/** Everything on the table, one row each: who it is, how it stands to the Dot, and the switch that says so. */
function TableList({ objects, sel, card }: { objects: BenchObject[]; sel: ReadonlySet<string>; card: Card }) {
  const { t, fmt } = useI18n();
  const { bench, select, mode, bus, live } = useHost();
  const state = useBenchState(bench);
  useSyncExternalStore(live.subscribe, live.getVersion);
  const motion = state.objects.find((o) => o.near && o.kind === MOTION_KIND);
  const pose = motion ? poseOf(motion) : ZERO_POSE;
  const pickRow = (id: string, add: boolean) => (add ? select.toggle(id) : select.only(id));
  const row = (id: string, tile: ReactNode, name: string, sub: string, near: boolean | null, toggle?: () => void, kind?: string) => (
    <li key={id} className={`inner flex items-center gap-1 p-1 pr-3 ${sel.has(id) ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : ''}`} data-testid={`row-${id === DOT_ID ? 'dot' : id === SD_ID ? 'sd' : 'object'}`} data-id={id} data-kind={kind} data-near={near ?? undefined} data-selected={sel.has(id)}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[inherit] border-0 bg-transparent p-1.5 text-left"
        aria-pressed={sel.has(id)}
        onClick={(e) => pickRow(id, e.shiftKey || e.ctrlKey || e.metaKey)}
        onDoubleClick={() => mode === 'workbench' && bus.send({ type: 'focus', id })}
        data-testid="row-select"
      >
        {tile}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold leading-snug" title={name}>
            {name}
          </span>
          <span className="block truncate text-[12.5px] leading-snug text-ink2" data-testid="row-state">
            {sub}
          </span>
        </span>
      </button>
      {toggle && <input type="checkbox" className="switch shrink-0" checked={!!near} onChange={toggle} aria-label={`${name}: ${sub}`} data-testid="row-near" />}
    </li>
  );
  return (
    <section className="flex flex-col gap-2" aria-label={t('wb.list')}>
      <h3 className="tag m-0">{t('wb.onTable')}</h3>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="table-list">
        {row(
          DOT_ID,
          <span className="icon-tile shrink-0 bg-[var(--tile-dark)] !text-white" style={{ width: 36, height: 36 }} aria-hidden>
            <Icon name="device" size={18} />
          </span>,
          t('wb.dot.name'),
          pose.pitch || pose.roll ? t('wb.dot.tilted', { pitch: fmt.number(pose.pitch), roll: fmt.number(pose.roll) }) : t('wb.dot.flat'),
          null,
        )}
        {row(SD_ID, <IconTile area="sd" size={36} />, t('kind.sd.card'), t(card.inserted ? 'presence.inSlot' : 'presence.ejected'), card.inserted, card.inserted === null ? undefined : card.toggle)}
        {objects.map((o) => {
          const kind = getKind(o.kind)!;
          const presence = kind.presence === 'none' ? null : kind.presence && typeof kind.presence === 'object' ? kind.presence : getArea(o.area).presence;
          const sub = presence ? t(o.near ? presence.on : presence.off) : t(kind.labelKey);
          return row(
            o.id,
            <IconTile area={o.area} size={36} />,
            o.name,
            sub,
            presence ? o.near : null,
            presence
              ? () => {
                  bench.checkpoint();
                  bench.setNear(o.id, !o.near);
                }
              : undefined,
            o.kind,
          );
        })}
      </ul>
      {objects.length === 0 && (
        <p className="m-0 text-[13.5px] leading-snug text-ink2" data-testid="bench-empty">
          {t('wb.empty')}
        </p>
      )}
    </section>
  );
}

/** What can be put on the table: click a tile, or drag it onto the table where it should stand. */
function Palette({ objects }: { objects: BenchObject[] }) {
  const { t } = useI18n();
  const { bench, select, bus, mode } = useHost();
  const planned = AREAS.filter((a) => !a.custom && kindsOf(a.id).length === 0);
  const kinds = KINDS.filter((k) => hasBody(k.key));
  const add = (k: KindDef) => {
    bench.checkpoint();
    const o = bench.add(k.key, `${t(k.labelKey)} ${bench.countOf(k.key) + 1}`);
    if (o) select.only(o.id);
  };
  return (
    <section className="flex flex-col gap-2" aria-label={t('wb.add')} data-testid="palette">
      <h3 className="tag m-0">{t('wb.add')}</h3>
      <p className="m-0 text-[13px] leading-snug text-ink2">{t(mode === 'workbench' ? 'wb.add.hint' : 'wb.add.hint.click')}</p>
      <ul className="m-0 grid list-none grid-cols-2 gap-1.5 p-0">
        {kinds.map((k) => {
          const taken = !!k.single && objects.some((o) => o.kind === k.key);
          return (
            <li key={k.key} className="min-w-0">
              <button
                type="button"
                className="inner flex h-full min-h-[var(--control-h)] w-full items-center gap-2 border-0 p-1.5 pr-2 text-left disabled:opacity-45"
                disabled={taken}
                draggable={!taken && mode === 'workbench'}
                onDragStart={(e) => {
                  e.dataTransfer.setData(KIND_MIME, k.key);
                  e.dataTransfer.effectAllowed = 'copy';
                  bus.setDragKind(k.key);
                }}
                onDragEnd={() => bus.setDragKind(null)}
                onClick={() => add(k)}
                title={taken ? t('wb.add.only', { kind: t(k.labelKey) }) : t(k.descKey)}
                aria-label={k.addKey ? t(k.addKey) : t('bench.addAnother', { kind: t(k.labelKey) })}
                data-testid={`add-${k.key}`}
              >
                <IconTile area={k.area} size={32} />
                <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-tight">{t(k.labelKey)}</span>
                <Icon name="plus" size={15} className="shrink-0 opacity-60" />
              </button>
            </li>
          );
        })}
      </ul>
      {planned.length > 0 && (
        <p className="m-0 text-[13px] leading-snug text-ink2" data-testid="soon-list">
          {t('wb.soon', { list: planned.map((a) => t(a.labelKey)).join(', ') })}
        </p>
      )}
    </section>
  );
}

/** True where real motion sensors can exist: touch devices whose browser exposes the events. */
export function useSensorsOffered(): boolean {
  const { layout } = useHost();
  const coarse = useCoarsePointer();
  const supported = typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  return supported && (coarse || isPhone(layout));
}

/** The switch that makes this phone's own motion sensors the Dot's: tilt and shake the phone, the Dot feels it. */
export function SensorSwitch({ testid = 'sensors-toggle' }: { testid?: string }) {
  const { t } = useI18n();
  const { sensorsOn, toggleSensors, sensorError } = useHost();
  return (
    <>
      <label className="flex cursor-pointer items-center gap-3 text-[14px]">
        <input type="checkbox" className="switch" checked={sensorsOn} onChange={() => void toggleSensors()} data-testid={testid} />
        <span className="min-w-0">
          <span className="font-semibold">{t(sensorsOn ? 'sensors.on' : 'sensors.off')}</span>
          <span className="block text-[13px] leading-snug text-ink2">{t('sensors.hint')}</span>
        </span>
      </label>
      {sensorError && (
        <p role="alert" className="m-0 text-[13.5px] font-semibold text-redtext">
          {t(sensorError)}
        </p>
      )}
    </>
  );
}

/** Real phone sensors as the source of tilt, in the Motion area. */
function SensorControls() {
  const { t } = useI18n();
  const offered = useSensorsOffered();
  if (!offered) return null;
  return (
    <div className="inner flex flex-col gap-2 p-4" data-testid="sensors-card">
      <h3 className="text-[17px]">{t('sensors.title')}</h3>
      <SensorSwitch />
    </div>
  );
}
