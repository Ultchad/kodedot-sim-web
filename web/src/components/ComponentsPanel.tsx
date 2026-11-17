import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { BenchObject, FieldValue } from '../bench/model';
import { WIRE_COLORS, termOwner, type Wire } from '../bench/store';
import { useI18n, type TKey } from '../i18n';
import { text3, type LibraryEntry, type PartField, type PartsService } from '../parts/service';
import { useBenchState } from '../state/bench';
import { useHost } from '../state/host';
import { KIND_MIME } from '../workbench/state';
import { SectionTitle } from './BenchPanel';
import { Icon, IconTile } from './Glyphs';
import { ScrollArea } from './ui';

const useParts = (p: PartsService): number => useSyncExternalStore(p.subscribe, p.getVersion);
const CATS: Record<string, TKey> = {
  passive: 'parts.cat.passive', power: 'parts.cat.power', prototyping: 'parts.cat.prototyping', actuator: 'parts.cat.actuator',
  input: 'parts.cat.input', sensor: 'parts.cat.sensor', mcu: 'parts.cat.mcu', wireless: 'parts.cat.wireless', module: 'parts.cat.module', 'kode-module': 'parts.cat.dotmodule',
};

/** The wired parts: the selected part's inspector, the parts on the table, and the library to take more from. */
export function ComponentsPanel({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useI18n();
  const { parts, bench, select, bus, mode } = useHost();
  useParts(parts);
  const state = useBenchState(bench);
  const sel = useSyncExternalStore(select.subscribe, select.get);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  useEffect(() => void parts.loadLibrary(), [parts]);
  const lib = parts.entries();
  const onTable = state.objects.filter((o) => o.area === 'part');
  const picked = onTable.find((o) => sel.size === 1 && sel.has(o.id));
  const pickedWire = sel.size === 1 ? state.wires.find((w) => sel.has(w.id)) : undefined;
  const cats = useMemo(() => [...new Set(lib.map((p) => p.category))].sort(), [lib]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lib.filter((p) => {
      if (cat && p.category !== cat) return false;
      if (!q) return true;
      const words = [text3(p.name, locale), p.name.en, ...(p.keywords?.[locale] ?? []), ...(p.keywords?.en ?? []), p.id];
      return words.some((w) => w.toLowerCase().includes(q));
    });
  }, [lib, query, cat, locale]);
  const nameOf = (id: string) => text3(lib.find((p) => p.id === id)?.name ?? parts.manifest(id)?.name, locale, id);
  const place = async (p: LibraryEntry) => {
    const o = await parts.place(p.id, `${text3(p.name, locale)} ${bench.countOf(p.id) + 1}`);
    if (o) select.only(o.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="components-panel">
      <SectionTitle title={t('nav.components')} subtitle={t('components.subtitle')} compact={compact} />
      <ScrollArea className="-mx-2 min-h-0 flex-1 px-2 py-1" label={t('nav.components')}>
        <div className="flex flex-col gap-4">
          {picked && <PartCard obj={picked} />}
          {pickedWire && <WireCard wire={pickedWire} />}
          {onTable.length > 0 && (
            <section className="flex flex-col gap-2" aria-label={t('parts.onTable')}>
              <h3 className="tag m-0">{t('parts.onTable')}</h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="parts-list">
                {onTable.map((o) => (
                  <li key={o.id} className={`inner flex items-center p-1 ${sel.has(o.id) ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : ''}`} data-testid="row-part" data-id={o.id} data-kind={o.kind}>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-[inherit] border-0 bg-transparent p-1.5 text-left"
                      aria-pressed={sel.has(o.id)}
                      onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? select.toggle(o.id) : select.only(o.id))}
                      onDoubleClick={() => mode === 'workbench' && bus.send({ type: 'focus', id: o.id })}
                    >
                      <IconTile area="part" size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-semibold leading-snug">{o.name}</span>
                        <span className="block truncate text-[12.5px] leading-snug text-ink2">{nameOf(o.kind)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {state.wires.length > 0 && (
            <section className="flex flex-col gap-2" aria-label={t('parts.wires')}>
              <h3 className="tag m-0">
                {t('parts.wires')} · {state.wires.length}
              </h3>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="wires-list">
                {state.wires.map((w) => (
                  <li key={w.id}>
                    <button
                      type="button"
                      className={`chip !gap-1.5 !px-2.5 font-mono text-[12px] ${sel.has(w.id) ? 'shadow-[inset_0_0_0_2px_var(--ink)]' : ''}`}
                      aria-pressed={sel.has(w.id)}
                      onClick={() => select.only(w.id)}
                      data-testid="row-wire"
                      data-id={w.id}
                    >
                      <span className="inline-block size-2.5 shrink-0 rounded-full border border-line" style={{ background: w.color }} />
                      {pinOf(w.from)} · {pinOf(w.to)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="flex flex-col gap-2" aria-label={t('parts.library')} data-testid="parts-library">
            <h3 className="tag m-0">{t('parts.library')}</h3>
            <input className="field-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('parts.search')} aria-label={t('parts.search')} autoComplete="off" spellCheck={false} data-testid="parts-search" />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('parts.library')}>
              {['', ...cats].map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={cat === c} onClick={() => setCat(c)} data-testid={`parts-cat-${c || 'all'}`}>
                  {c ? t(CATS[c] ?? 'parts.cat.other') : t('parts.all')}
                </button>
              ))}
            </div>
            <p className="m-0 text-[13px] leading-snug text-ink2">{t('parts.add.hint')}</p>
            {parts.error && lib.length === 0 ? (
              <p role="alert" className="m-0 text-[13.5px] font-semibold text-redtext">
                {t('parts.failed', { why: parts.error })}
              </p>
            ) : lib.length === 0 ? (
              <p className="m-0 text-[13.5px] text-ink2">{t('parts.loading')}</p>
            ) : shown.length === 0 ? (
              <p className="m-0 text-[13.5px] text-ink2">{t('parts.none')}</p>
            ) : (
              <ul className="m-0 grid list-none grid-cols-2 gap-1.5 p-0">
                {shown.map((p) => (
                  <li key={p.id} className="min-w-0">
                    <button
                      type="button"
                      className="inner flex h-full min-h-[var(--control-h)] w-full items-center gap-2 border-0 p-1.5 pr-2 text-left"
                      draggable={mode === 'workbench'}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(KIND_MIME, `part:${p.id}|${text3(p.name, locale)} ${bench.countOf(p.id) + 1}`);
                        e.dataTransfer.effectAllowed = 'copy';
                        void parts.ensurePart(p.id);
                      }}
                      onClick={() => void place(p)}
                      title={text3(p.description, locale) || undefined}
                      data-testid={`part-${p.id}`}
                    >
                      <IconTile area="part" size={32} />
                      <span className="min-w-0 flex-1 text-[13.5px] font-semibold leading-tight">{text3(p.name, locale)}</span>
                      <Icon name="plus" size={15} className="shrink-0 opacity-60" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </div>
  );
}

/** One wired part: its fields, what its pins carry right now, its problems and the repair. */
const pinOf = (term: string) => term.slice(term.indexOf('.') + 1);

/** One wire: where it goes, its colour, away with it. */
function WireCard({ wire }: { wire: Wire }) {
  const { t } = useI18n();
  const { parts, bench } = useHost();
  const end = (term: string) => {
    const owner = termOwner(term);
    return `${pinOf(term)} · ${owner === 'device' ? t('parts.wire.header') : (bench.get(owner)?.name ?? owner)}`;
  };
  const short = parts.state().wires.find((w) => w.id === wire.id)?.short;
  return (
    <section className="inner anim-fade flex flex-col gap-3 p-4" data-testid="wire-card" data-id={wire.id}>
      <div className="flex items-center gap-3">
        <span className="inline-block size-4 shrink-0 rounded-full border border-line" style={{ background: wire.color }} />
        <h3 className="min-w-0 flex-1 text-[17px] leading-snug">{t('parts.wire')}</h3>
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => (bench.checkpoint(), bench.removeWires([wire.id]))} aria-label={t('bench.delete')} title={t('bench.delete')} data-testid="wire-delete">
          <Icon name="trash" />
        </button>
      </div>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[14px]">
        <li data-testid="wire-from">{end(wire.from)}</li>
        <li data-testid="wire-to">{end(wire.to)}</li>
      </ul>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('wb.wire.color')}>
        {WIRE_COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            className={`size-7 rounded-full border border-line ${wire.color === c ? 'shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--ink)]' : ''}`}
            style={{ background: c }}
            aria-label={`${t('wb.wire.color')} ${i + 1}`}
            aria-pressed={wire.color === c}
            onClick={() => (bench.checkpoint(), bench.setWireColor(wire.id, c))}
            data-testid={`wire-color-${i}`}
          />
        ))}
      </div>
      {parts.refused.has(wire.id) && <p className="m-0 text-[13.5px] text-[var(--red-text)]">{t('parts.wire.refused')}</p>}
      {short && <p className="m-0 text-[13.5px] text-[var(--red-text)]">{t('parts.wire.short')}</p>}
    </section>
  );
}

function PartCard({ obj }: { obj: BenchObject }) {
  const { t, locale, fmt } = useI18n();
  const { parts, bench, select, bus, mode } = useHost();
  const m = parts.manifest(obj.kind);
  const st = parts.stateOf(obj.id);
  const hazards = parts.hazardsOf(obj.id);
  const mounted = useBenchState(bench).mounts[obj.id];
  const plug = parts.plugs().get(obj.id);
  const out = st?.outputs ?? {};
  const broken = out.burnt === true || out.burst === true || hazards.some((h) => h.class === 'burnt');
  const set = (f: PartField, v: FieldValue) => {
    bench.checkpoint(`field:${obj.id}:${f.name}`);
    bench.setField(obj.id, f.name, v);
  };
  return (
    <section className="inner anim-fade flex flex-col gap-3 p-4" data-testid="part-card" data-id={obj.id} data-kind={obj.kind}>
      <div className="flex items-center gap-3">
        <IconTile area="part" size={40} />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-[17px] leading-snug">{obj.name}</h3>
          <p className="tag m-0 mt-0.5 !text-[11px]">{text3(m?.name, locale, obj.kind)}</p>
        </div>
      </div>
      <div className="-my-1 flex flex-wrap justify-end gap-1">
        {mode === 'workbench' && (
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => bus.send({ type: 'focus', id: obj.id })} aria-label={t('wb.locate')} title={t('wb.locate')}>
            <Icon name="target" />
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => (bench.checkpoint(), bench.rotate([obj.id]))} aria-label={t('wb.rotate.hint')} title={t('wb.rotate.hint')} data-testid="part-rotate">
          <Icon name="rotate" />
        </button>
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => (bench.checkpoint(), select.only(bench.duplicate(obj.id)?.id ?? obj.id))} aria-label={t('bench.duplicate')} title={t('bench.duplicate')} data-testid="part-duplicate">
          <Icon name="copy" />
        </button>
        <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={() => (bench.checkpoint(), bench.remove(obj.id))} aria-label={t('bench.delete')} title={t('bench.delete')} data-testid="part-delete">
          <Icon name="trash" />
        </button>
      </div>
      {parts.coreOf(obj.kind) && (
        <button type="button" className="btn btn-sm btn-primary self-start" onClick={() => bus.openCode(obj.id)} data-testid="part-code">
          {t('code.open')}
        </button>
      )}
      {m?.mount && (
        <div className="flex flex-wrap items-center gap-2" data-testid="part-mount">
          {mounted ? (
            <>
              <span className="tag flex-1">{t('parts.mount.is')}</span>
              <button type="button" className="btn btn-sm" onClick={() => parts.mount(obj.id, null)} data-testid="part-unmount">
                {t('parts.mount.off')}
              </button>
            </>
          ) : (
            (m.mount.orientations ?? ['upright']).map((side) => (
              <button key={side} type="button" className="btn btn-sm" onClick={() => parts.mount(obj.id, side)} data-testid={`part-mount-${side}`}>
                {t(side === 'turned' ? 'parts.mount.turned' : 'parts.mount.upright')}
              </button>
            ))
          )}
        </div>
      )}
      {plug && <p className="tag m-0" data-testid="part-plugged">{t('parts.plugged', { host: bench.get(plug.host)?.name ?? plug.host })}</p>}
      {(m?.fields ?? []).length > 0 && (
        <div className="flex flex-col gap-1.5">
          {m!.fields!.map((f) => {
            const v = obj.fields[f.name] ?? f.default;
            const label = text3(f.label, locale, f.name);
            if (f.type === 'boolean')
              return (
                <label key={f.name} className="flex cursor-pointer items-center gap-3 text-[14px]">
                  <input type="checkbox" className="switch" checked={v === true} onChange={(e) => set(f, e.target.checked)} data-testid={`pfield-${f.name}`} />
                  {label}
                </label>
              );
            return (
              <label key={f.name} className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto] items-center gap-2 text-[14px] font-semibold">
                {label}
                {f.type === 'enum' ? (
                  <select className="field-input" value={String(v)} onChange={(e) => set(f, f.values?.find((x) => String(x.value) === e.target.value)?.value ?? e.target.value)} data-testid={`pfield-${f.name}`}>
                    {(f.values ?? []).map((x) => (
                      <option key={String(x.value)} value={String(x.value)}>
                        {text3(x.label, locale, String(x.value))}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className="field-input" type="number" min={f.min} max={f.max} step={f.step ?? 'any'} value={Number(v)} onChange={(e) => e.target.value !== '' && set(f, Number(e.target.value))} data-testid={`pfield-${f.name}`} />
                )}
                <span className="text-[13px] font-medium text-ink2">{f.unit ?? ''}</span>
              </label>
            );
          })}
        </div>
      )}
      {(broken || hazards.length > 0 || st?.crashed) && (
        <div className="flex flex-col gap-2" role="alert" data-testid="part-hazards">
          {hazards.map((h, i) => (
            <p key={i} className="m-0 text-[13.5px] font-semibold leading-snug text-redtext">
              {t('parts.hazard', { what: h.text ?? h.class })}
            </p>
          ))}
          {st?.crashed && <p className="m-0 text-[13.5px] font-semibold text-redtext">{t('parts.crashed')}</p>}
          {broken && (
            <button type="button" className="btn btn-sm btn-primary self-start" onClick={() => parts.repair(obj.id)} data-testid="part-repair">
              {t('parts.repair')}
            </button>
          )}
        </div>
      )}
      {st && (
        <div className="flex flex-col gap-1" data-testid="part-pins">
          <span className="tag">
            {t('parts.pins')} · {t(st.power.on ? 'parts.power.on' : 'parts.power.off')}
          </span>
          <ul className="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-0.5 p-0 text-[13px] tabular-nums">
            {Object.entries(st.pins)
              .slice(0, 24)
              .map(([name, p]) => (
                <li key={name} className="flex justify-between gap-2">
                  <span className="font-mono font-semibold">{name}</span>
                  <span className="text-ink2">{p.floating ? t('parts.pin.floating') : `${fmt.number(Math.round(p.mv) / 1000)} V`}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </section>
  );
}
