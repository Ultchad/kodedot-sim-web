import { useRef, useState, type DragEvent } from 'react';
import { getKind, kindsOf } from '../bench/kinds';
import { AREAS, getArea, type AreaDef, type AreaId, type BenchObject, type FieldDef, type KindDef } from '../bench/model';
import { useBenchState } from '../state/bench';
import { useI18n } from '../i18n';
import { isPhone } from '../lib/layout';
import { loadPref, savePref } from '../lib/prefs';
import { useHost } from '../state/host';
import { Glyph, Icon, IconTile } from './Glyphs';
import { MenuButton, ScrollArea, useCoarsePointer, useTabs } from './ui';

const DND_TYPE = 'application/x-dotbench-object';
/** Tab that lists the areas that are not built yet, so they stay visible without taking the room of the working ones. */
const SOON = 'soon';
type BenchTab = AreaId | typeof SOON;

/** `compact`: the tab row right above already names the section (phone sheet), so the title is kept for screen readers only. */
export function SectionTitle({ title, subtitle, compact = false }: { title: string; subtitle: string; compact?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className={compact ? 'sr-only' : 'text-[24px] leading-tight'}>{title}</h2>
      <p className="m-0 text-[14px] leading-snug text-ink2">{subtitle}</p>
    </div>
  );
}

export function BenchPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const host = useHost();
  const state = useBenchState(host.bench);
  const working = AREAS.filter((a) => kindsOf(a.id).length > 0);
  const planned = AREAS.filter((a) => kindsOf(a.id).length === 0);
  const ids: BenchTab[] = [...working.map((a) => a.id), ...(planned.length ? [SOON as BenchTab] : [])];
  const [tab, setTabState] = useState<BenchTab>(() => {
    const a = loadPref<string>('dotbench.area', '');
    return (ids as string[]).includes(a) ? (a as BenchTab) : ids[0];
  });
  const setTab = (id: BenchTab) => {
    setTabState(id);
    savePref('dotbench.area', id);
  };
  const tabs = useTabs(ids, tab, setTab);
  const area = working.find((a) => a.id === tab);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="bench-panel">
      <SectionTitle title={t('nav.bench')} subtitle={t('bench.subtitle')} compact={compact} />

      <div {...tabs.list} aria-label={t('bench.areas')} className="flex flex-wrap gap-1.5">
        {working.map((a) => {
          const inUse = !!state.slots[a.id];
          return (
            <button key={a.id} {...tabs.tab(a.id)} className="chip" data-testid={`area-${a.id}`} title={inUse ? t('bench.areaInUse', { area: t(a.labelKey) }) : undefined}>
              <Glyph area={a.id} size={16} />
              {t(a.labelKey)}
              {inUse && <span aria-hidden className="h-2 w-2 rounded-full bg-primary" />}
              {inUse && <span className="sr-only">{t('bench.inUse')}</span>}
            </button>
          );
        })}
        {planned.length > 0 && (
          <button {...tabs.tab(SOON)} className="chip" data-testid="area-soon">
            {t('bench.soonTab')}
            <span className="font-medium opacity-70">{planned.length}</span>
          </button>
        )}
      </div>

      <ScrollArea {...tabs.panel(tab)} key={tab} className="anim-fade -mx-2 min-h-0 flex-1 px-2 py-1" label={area ? t(area.labelKey) : t('bench.soonTab')}>
        {area ? <AreaBody area={area} /> : <SoonList areas={planned} />}
      </ScrollArea>
    </div>
  );
}

/** Planned areas: one compact row each, in plain words, with no controls that cannot do anything yet. */
function SoonList({ areas }: { areas: AreaDef[] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2" data-testid="soon-list">
      <p className="m-0 text-[13.5px] leading-snug text-ink2">{t('bench.soonIntro')}</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {areas.map((a) => (
          <li key={a.id} className="inner flex items-center gap-3 px-3 py-2.5" data-area={a.id}>
            <IconTile area={a.id} size={36} dim />
            <div className="min-w-0 flex-1">
              <h3 className="font-sans text-[14.5px] font-semibold tracking-normal">{t(a.labelKey)}</h3>
              <p className="m-0 text-[13px] leading-snug text-ink2">{t(a.plannedKey)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AreaBody({ area }: { area: AreaDef }) {
  const { t } = useI18n();
  const host = useHost();
  const state = useBenchState(host.bench);
  const kinds = kindsOf(area.id);
  const objects = state.objects.filter((o) => o.area === area.id && getKind(o.kind));
  const active = state.slots[area.id];
  const add = (k: KindDef) => {
    const obj = host.bench.add(k.key, `${t(k.labelKey)} ${host.bench.countOf(k.key) + 1}`);
    // Non-radio objects have nothing to "bring near": use them right away.
    if (obj && !area.radio && !host.bench.activeIn(area.id)) host.bench.bringNear(obj.id);
  };

  return (
    <div className="flex flex-col gap-3" data-area={area.id}>
      {objects.length === 0 ? (
        // empty state: what this area is, and the one thing to do next
        <div className="inner flex flex-col gap-3 p-4" data-testid="bench-empty">
          {kinds.map((k) => (
            <div key={k.key} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <IconTile area={area.id} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[17px] leading-snug">{t(k.labelKey)}</h3>
                  <p className="m-0 mt-0.5 text-[13.5px] leading-snug text-ink2">{t(k.descKey)}</p>
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-wrap self-start" data-testid={`add-${k.key}`} onClick={() => add(k)}>
                <Icon name="plus" />
                {t('bench.addFirst')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          {area.radio && <Slot area={area} activeObj={objects.find((o) => o.id === active)} />}
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {objects.map((o) => (
              <ObjectCard key={o.id} obj={o} active={o.id === active} />
            ))}
          </ul>
          {kinds.map((k) => (
            <button key={k.key} type="button" className="btn btn-sm btn-dashed btn-wrap self-start" data-testid={`add-${k.key}`} onClick={() => add(k)}>
              <Icon name="plus" size={16} />
              {t('bench.addAnother', { kind: t(k.labelKey) })}
            </button>
          ))}
        </>
      )}
      {area.id === 'motion' && <SensorControls />}
    </div>
  );
}

/** The "near the device" slot of a radio area (NFC, Wi-Fi, ...): a drop target that also says what is there. */
function Slot({ area, activeObj }: { area: AreaDef; activeObj?: BenchObject }) {
  const { t } = useI18n();
  const { bench } = useHost();
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(DND_TYPE);
    const o = id && bench.get(id);
    if (o && o.area === area.id) bench.bringNear(id);
  };
  return (
    <div
      data-testid={`slot-${area.id}`}
      data-occupied={!!activeObj}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex min-h-12 items-center gap-3 rounded-2xl px-4 py-2 text-[14px] ${activeObj ? 'bg-primary text-primaryink' : 'shadow-[inset_0_0_0_1px_var(--ink3)]'} ${over ? '!bg-soft !shadow-[inset_0_0_0_2px_var(--ink)]' : ''}`}
    >
      <span className={`tag shrink-0 ${activeObj ? '!text-primaryink' : ''}`}>{t(area.slotKey)}</span>
      {activeObj ? (
        <span className="min-w-0 flex-1 truncate font-semibold" title={activeObj.name}>
          {activeObj.name}
        </span>
      ) : (
        <span className="text-ink2">{t('bench.slot.empty', { verb: t(area.verbs.on) })}</span>
      )}
    </div>
  );
}

function ObjectCard({ obj, active }: { obj: BenchObject; active: boolean }) {
  const { t } = useI18n();
  const { bench, device } = useHost();
  const kind = getKind(obj.kind)!;
  const area = getArea(obj.area);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    bench.rename(obj.id, inputRef.current?.value ?? obj.name);
    setRenaming(false);
  };

  return (
    <li
      draggable={area.radio && !renaming}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DND_TYPE, obj.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="inner flex flex-col gap-3 p-4"
      data-testid="bench-object"
      data-active={active}
    >
      <div className="flex items-start gap-3">
        <IconTile area={obj.area} />
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input ref={inputRef} autoFocus defaultValue={obj.name} aria-label={t('bench.rename')} className="field-input !h-9 !px-3" onBlur={commitRename} onKeyDown={(e) => (e.key === 'Enter' ? commitRename() : e.key === 'Escape' ? (e.stopPropagation(), setRenaming(false)) : undefined)} data-testid="rename-input" />
          ) : (
            <h3 className="break-words text-[17px] leading-snug" title={obj.name}>
              {obj.name}
            </h3>
          )}
          <p className="m-0 mt-0.5 text-[13.5px] leading-snug text-ink2">{t(kind.descKey)}</p>
        </div>
        <div className="-mr-2 -mt-2 shrink-0">
          <MenuButton
            label={t('bench.objectMenu', { name: obj.name })}
            testid="object-menu"
            entries={[
              { id: 'rename', label: t('bench.rename'), icon: 'pencil', onSelect: () => setRenaming(true) },
              { id: 'duplicate', label: t('bench.duplicate'), icon: 'copy', onSelect: () => bench.duplicate(obj.id) },
              { id: 'delete', label: t('bench.delete'), icon: 'trash', danger: true, onSelect: () => bench.remove(obj.id) },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {kind.fields.map((f) => (
          <Field key={f.key} def={f} obj={obj} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {kind.actions?.map((a) => (
          <button key={a.key} type="button" className="btn btn-sm" disabled={!active} title={active ? undefined : t('bench.needActive')} data-testid={`action-${a.key}`} onClick={() => kind.run?.(device, obj, a.key)}>
            {t(a.labelKey)}
          </button>
        ))}
        <div className="flex-1" />
        {/* a switch says "in use" and changes it in one control; the label carries the area's own wording */}
        <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold">
          <span data-testid="near-state">{t(active ? area.slotKey : area.verbs.on)}</span>
          <input type="checkbox" className="switch" checked={active} data-testid="toggle-near" onChange={() => (active ? bench.takeAway(obj.id) : bench.bringNear(obj.id))} />
        </label>
      </div>
    </li>
  );
}

function Field({ def, obj }: { def: FieldDef; obj: BenchObject }) {
  const { t, fmt } = useI18n();
  const { bench } = useHost();
  const id = `f-${obj.id}-${def.key}`;
  const v = obj.fields[def.key];
  if (def.type === 'range') {
    return (
      <div className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_3.25rem] items-center gap-2">
        <label htmlFor={id} className="text-[14px] font-semibold">
          {t(def.labelKey)}
        </label>
        <input id={id} type="range" min={def.min} max={def.max} step={def.step} value={Number(v)} onChange={(e) => bench.setField(obj.id, def.key, Number(e.target.value))} data-testid={`field-${def.key}`} />
        <output htmlFor={id} className="text-right text-[14px] tabular-nums text-ink2">
          {fmt.number(Number(v))}
          {def.unit}
        </output>
      </div>
    );
  }
  if (def.type === 'toggle') {
    return (
      <label className="flex cursor-pointer items-center gap-3 text-[14px]">
        <input type="checkbox" className="switch" checked={Boolean(v)} onChange={(e) => bench.setField(obj.id, def.key, e.target.checked)} />
        {t(def.labelKey)}
      </label>
    );
  }
  if (def.type === 'select') {
    return (
      <label className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] items-center gap-2 text-[14px] font-semibold">
        {t(def.labelKey)}
        <select className="field-input" value={String(v)} onChange={(e) => bench.setField(obj.id, def.key, e.target.value)}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] items-center gap-2 text-[14px] font-semibold">
      {t(def.labelKey)}
      <input className="field-input" type={def.type === 'number' ? 'number' : 'text'} value={String(v ?? '')} onChange={(e) => bench.setField(obj.id, def.key, def.type === 'number' ? Number(e.target.value) : e.target.value)} />
    </label>
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
