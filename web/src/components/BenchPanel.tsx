import { useState } from 'react';
import { getKind, kindsOf } from '../bench/kinds';
import { AREAS, type AreaDef, type AreaId, type KindDef } from '../bench/model';
import { useBenchState } from '../state/bench';
import { useI18n } from '../i18n';
import { isPhone } from '../lib/layout';
import { loadPref, savePref } from '../lib/prefs';
import { useHost } from '../state/host';
import { Glyph, Icon, IconTile } from './Glyphs';
import { ScrollArea, useCoarsePointer, useTabs } from './ui';
import { ObjectCard } from './bench/ObjectCard';
import { SdPanel } from './bench/SdPanel';

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
  const working = AREAS.filter((a) => a.custom || kindsOf(a.id).length > 0);
  const planned = AREAS.filter((a) => !a.custom && kindsOf(a.id).length === 0);
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
          const inUse = state.objects.some((o) => o.area === a.id && o.near);
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
  const add = (k: KindDef) => host.bench.add(k.key, `${t(k.labelKey)} ${host.bench.countOf(k.key) + 1}`);
  // a kind with one object at most that is already there has no add button
  const addable = kinds.filter((k) => !(k.single && objects.some((o) => o.kind === k.key)));

  if (area.custom) return <SdPanel />;

  return (
    <div className="flex flex-col gap-3" data-area={area.id}>
      {objects.length === 0 ? (
        // empty state: what this area is, and the one thing to do next
        <div className="inner flex flex-col gap-4 p-4" data-testid="bench-empty">
          {kinds.map((k) => (
            <div key={k.key} className="flex flex-col gap-2.5">
              <div className="flex items-start gap-3">
                <IconTile area={area.id} size={40} />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[17px] leading-snug">{t(k.labelKey)}</h3>
                  <p className="m-0 mt-0.5 text-[13.5px] leading-snug text-ink2">{t(k.descKey)}</p>
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-wrap self-start" data-testid={`add-${k.key}`} onClick={() => add(k)}>
                <Icon name="plus" />
                {t(k.addKey ?? 'bench.addFirst')}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {objects.map((o) => (
              <ObjectCard key={o.id} obj={o} />
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {addable.map((k) => (
              <button key={k.key} type="button" className="btn btn-sm btn-dashed btn-wrap" data-testid={`add-${k.key}`} onClick={() => add(k)}>
                <Icon name="plus" size={16} />
                {k.addKey ? t(k.addKey) : t('bench.addAnother', { kind: t(k.labelKey) })}
              </button>
            ))}
          </div>
        </>
      )}
      {area.id === 'motion' && <SensorControls />}
    </div>
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
