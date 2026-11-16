import { useRef, useState, type DragEvent } from 'react';
import { getKind, kindsOf } from '../bench/kinds';
import { AREAS, getArea, type AreaDef, type BenchObject, type FieldDef } from '../bench/model';
import { useBenchState } from '../state/bench';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';

const DND_TYPE = 'application/x-dotbench-object';

export function BenchPanel() {
  const { t } = useI18n();
  const host = useHost();
  const state = useBenchState(host.bench);
  const [open, setOpen] = useState<Record<string, boolean>>({ motion: true });

  const near = AREAS.map((a) => ({ area: a, obj: state.slots[a.id] ? state.objects.find((o) => o.id === state.slots[a.id]) : undefined })).filter((x) => x.obj);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="bench-panel">
      <div className="border-b border-line px-3 py-2">
        <div className="eyebrow mb-1">{t('bench.nearSummary')}</div>
        {near.length === 0 ? (
          <div className="text-[12px] text-ink3">{t('bench.nothingNear')}</div>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {near.map(({ area, obj }) => (
              <li key={area.id} className="rounded border border-accent/60 bg-accent/10 px-1.5 py-0.5 text-[11px]">
                <span className="text-ink3">{t(area.labelKey)}:</span> {obj!.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {AREAS.map((area) => (
          <Section key={area.id} area={area} open={!!open[area.id]} onToggle={() => setOpen((o) => ({ ...o, [area.id]: !o[area.id] }))} />
        ))}
      </div>
    </div>
  );
}

function Section({ area, open, onToggle }: { area: AreaDef; open: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  const host = useHost();
  const state = useBenchState(host.bench);
  const kinds = kindsOf(area.id);
  const objects = state.objects.filter((o) => o.area === area.id && getKind(o.kind));
  const active = state.slots[area.id];
  const bodyId = `sec-${area.id}`;

  return (
    <section className="border-b border-line" data-area={area.id}>
      <h3 className="m-0">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel2" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <span aria-hidden className={`inline-block text-ink3 transition-transform ${open ? 'rotate-90' : ''}`}>
            ▸
          </span>
          <span className="flex-1 text-[13px] font-medium">{t(area.labelKey)}</span>
          {kinds.length === 0 ? <span className="eyebrow">{t('bench.stage', { stage: area.stage })}</span> : <span className="eyebrow">{objects.length}</span>}
        </button>
      </h3>
      {open && (
        <div id={bodyId} className="px-3 pb-3">
          <Slot area={area} activeObj={objects.find((o) => o.id === active)} />
          {kinds.length === 0 ? (
            <div className="mt-2 rounded-md border border-line bg-panel2/60 p-2.5">
              <div className="text-[12px] font-medium text-ink2">{t('bench.soon', { stage: area.stage })}</div>
              <div className="mt-0.5 text-[11.5px] text-ink3">{t('bench.planned', { planned: t(area.plannedKey) })}</div>
            </div>
          ) : (
            <>
              {objects.length === 0 && <div className="mt-2 text-[12px] text-ink3">{t('bench.noObjects')}</div>}
              <ul className="mt-2 flex flex-col gap-2">
                {objects.map((o) => (
                  <ObjectCard key={o.id} obj={o} active={o.id === active} />
                ))}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2">
                {kinds.map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    className="btn"
                    data-testid={`add-${k.key}`}
                    onClick={() => {
                      const obj = host.bench.add(k.key, `${t(k.labelKey)} ${host.bench.countOf(k.key) + 1}`);
                      // Non-radio objects have nothing to "bring near": use them right away.
                      if (obj && !area.radio && !host.bench.activeIn(area.id)) host.bench.bringNear(obj.id);
                    }}
                  >
                    + {t(k.labelKey)}
                  </button>
                ))}
              </div>
              {area.id === 'motion' && <SensorControls />}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** The visible "near the device" / "in use" slot of an area. Drop target and status in one. */
function Slot({ area, activeObj }: { area: AreaDef; activeObj?: BenchObject }) {
  const { t } = useI18n();
  const { bench } = useHost();
  const [over, setOver] = useState(false);
  const accepts = area.radio || kindsOf(area.id).length > 0;
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
        if (accepts && e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] ${activeObj ? 'border-accent/70 bg-accent/10' : 'border-dashed border-line2'} ${over ? 'border-accent bg-accent/15' : ''} ${accepts ? '' : 'opacity-60'}`}
    >
      <span className="eyebrow shrink-0">{t(area.slotKey)}</span>
      {activeObj ? (
        <>
          <span className="min-w-0 flex-1 truncate">{activeObj.name}</span>
          <button type="button" className="btn h-6 px-2 text-[11px]" onClick={() => bench.takeAway(activeObj.id)} data-testid={`away-${area.id}`}>
            {t(area.verbs.off)}
          </button>
        </>
      ) : (
        <span className="text-ink3">{accepts ? t('bench.slot.empty', { verb: t(area.verbs.on) }) : t('bench.slot.none')}</span>
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
  const [confirm, setConfirm] = useState(false);
  const confirmTimer = useRef<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    const v = inputRef.current?.value ?? obj.name;
    bench.rename(obj.id, v);
    setRenaming(false);
  };

  return (
    <li
      draggable={!renaming}
      onDragStart={(e: DragEvent) => {
        e.dataTransfer.setData(DND_TYPE, obj.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`rounded-md border bg-panel2/70 ${active ? 'border-accent/70' : 'border-line'}`}
      data-testid="bench-object"
      data-active={active}
    >
      <div className="flex items-center gap-1.5 px-2 pt-2">
        {renaming ? (
          <input
            ref={inputRef}
            autoFocus
            defaultValue={obj.name}
            aria-label={t('bench.rename')}
            className="field-input"
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium" title={obj.name}>
            {obj.name}
          </span>
        )}
        <button type="button" className="btn btn-ghost h-6 px-1.5" onClick={() => setRenaming(true)} aria-label={t('bench.rename')} title={t('bench.rename')}>
          ✎
        </button>
        <button type="button" className="btn btn-ghost h-6 px-1.5" onClick={() => bench.duplicate(obj.id)} aria-label={t('bench.duplicate')} title={t('bench.duplicate')} data-testid="duplicate">
          ⧉
        </button>
        <button
          type="button"
          className={`btn btn-ghost h-6 px-1.5 ${confirm ? '!border-bad !text-bad' : ''}`}
          aria-label={confirm ? t('bench.confirmDelete') : t('bench.delete')}
          title={confirm ? t('bench.confirmDelete') : t('bench.delete')}
          data-testid="delete"
          onClick={() => {
            if (confirm) {
              clearTimeout(confirmTimer.current);
              bench.remove(obj.id);
            } else {
              setConfirm(true);
              confirmTimer.current = window.setTimeout(() => setConfirm(false), 3000);
            }
          }}
        >
          {confirm ? t('bench.confirmDelete') : '✕'}
        </button>
      </div>

      <div className="flex flex-col gap-2 px-2 py-2">
        {kind.fields.map((f) => (
          <Field key={f.key} def={f} obj={obj} />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-2 py-2">
        <button
          type="button"
          className={`btn ${active ? 'is-on' : ''}`}
          aria-pressed={active}
          data-testid="toggle-near"
          onClick={() => (active ? bench.takeAway(obj.id) : bench.bringNear(obj.id))}
        >
          {t(active ? area.verbs.off : area.verbs.on)}
        </button>
        {kind.actions?.map((a) => (
          <button key={a.key} type="button" className="btn" disabled={!active} title={active ? undefined : t('bench.needActive')} data-testid={`action-${a.key}`} onClick={() => kind.run?.(device, obj, a.key)}>
            {t(a.labelKey)}
          </button>
        ))}
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
      <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2">
        <label htmlFor={id} className="truncate text-[12px] text-ink2">
          {t(def.labelKey)}
        </label>
        <input id={id} type="range" min={def.min} max={def.max} step={def.step} value={Number(v)} onChange={(e) => bench.setField(obj.id, def.key, Number(e.target.value))} data-testid={`field-${def.key}`} />
        <output htmlFor={id} className="text-right font-mono text-[12px]">
          {fmt.number(Number(v))}
          {def.unit}
        </output>
      </div>
    );
  }
  if (def.type === 'toggle') {
    return (
      <label className="flex items-center gap-2 text-[12px]">
        <input type="checkbox" checked={Boolean(v)} onChange={(e) => bench.setField(obj.id, def.key, e.target.checked)} />
        {t(def.labelKey)}
      </label>
    );
  }
  if (def.type === 'select') {
    return (
      <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[12px] text-ink2">
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
    <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 text-[12px] text-ink2">
      {t(def.labelKey)}
      <input
        className="field-input"
        type={def.type === 'number' ? 'number' : 'text'}
        value={String(v ?? '')}
        onChange={(e) => bench.setField(obj.id, def.key, def.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </label>
  );
}

function SensorControls() {
  const { t } = useI18n();
  const { sensorsOn, toggleSensors, sensorError } = useHost();
  return (
    <div className="mt-3 rounded-md border border-line p-2.5">
      <div className="eyebrow mb-1.5">{t('sensors.title')}</div>
      <button type="button" className={`btn ${sensorsOn ? 'is-on' : ''}`} aria-pressed={sensorsOn} onClick={() => void toggleSensors()} data-testid="sensors-toggle">
        {t(sensorsOn ? 'sensors.on' : 'sensors.off')}
      </button>
      <p className="mb-0 mt-1.5 text-[11.5px] text-ink3">{t('sensors.hint')}</p>
      {sensorError && (
        <p role="alert" className="mb-0 mt-1.5 text-[11.5px] text-bad">
          {t(sensorError)}
        </p>
      )}
    </div>
  );
}
