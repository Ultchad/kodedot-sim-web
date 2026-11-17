import { useI18n } from '../../i18n';
import type { BenchObject, FieldDef } from '../../bench/model';
import { useHost } from '../../state/host';

/** One editable field of a bench object. */
export function Field({ def, obj }: { def: FieldDef; obj: BenchObject }) {
  const { t, fmt } = useI18n();
  const { bench: store } = useHost();
  // an edit of a field is a bench edit: it can be undone (typing and sliding count as one step)
  const bench = {
    setField(id: string, key: string, value: string | number | boolean) {
      store.checkpoint(`field:${id}:${key}`);
      store.setField(id, key, value);
    },
  };
  const id = `f-${obj.id}-${def.key}`;
  const v = obj.fields[def.key];
  if (def.when && !def.when(obj.fields)) return null;
  if (def.type === 'range') {
    return (
      <div className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_4.5rem] items-center gap-2">
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
        <input id={id} type="checkbox" className="switch" checked={Boolean(v)} onChange={(e) => bench.setField(obj.id, def.key, e.target.checked)} data-testid={`field-${def.key}`} />
        {t(def.labelKey)}
      </label>
    );
  }
  if (def.type === 'select') {
    return (
      <label className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] items-center gap-2 text-[14px] font-semibold">
        {t(def.labelKey)}
        <select id={id} className="field-input" value={String(v)} onChange={(e) => bench.setField(obj.id, def.key, e.target.value)} data-testid={`field-${def.key}`}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.labelKey ? t(o.labelKey) : (o.label ?? o.value)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)] items-center gap-2 text-[14px] font-semibold">
      {t(def.labelKey)}
      <input
        id={id}
        className={`field-input ${def.type === 'text' && def.mono ? 'font-mono !px-3 !text-[12px] tracking-tight' : ''}`}
        type={def.type === 'number' ? 'number' : 'text'}
        placeholder={def.type === 'text' ? def.placeholder : undefined}
        autoComplete="off"
        spellCheck={false}
        value={String(v ?? '')}
        onChange={(e) => bench.setField(obj.id, def.key, def.type === 'number' ? Number(e.target.value) : e.target.value)}
        data-testid={`field-${def.key}`}
      />
    </label>
  );
}
