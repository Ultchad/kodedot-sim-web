import { useRef, useState } from 'react';
import { getKind } from '../../bench/kinds';
import { getArea, type BenchObject } from '../../bench/model';
import { useI18n } from '../../i18n';
import { useLive } from '../../state/hooks';
import { useHost } from '../../state/host';
import { IconTile } from '../Glyphs';
import { MenuButton } from '../ui';
import { viewOf } from './views';

/** One bench object: who it is, what it is doing with the Dot, and the near/away switch. The body is the kind's own view. */
export function ObjectCard({ obj }: { obj: BenchObject }) {
  const { t } = useI18n();
  const { bench, device, live } = useHost();
  const kind = getKind(obj.kind)!;
  const area = getArea(obj.area);
  const [renaming, setRenaming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const View = viewOf(obj.kind);
  const last = useLive(live, obj.id).entries.at(-1);
  const presence = kind.presence && kind.presence !== 'none' ? kind.presence : kind.presence === 'none' ? null : area.presence;

  const commitRename = () => {
    bench.rename(obj.id, inputRef.current?.value ?? obj.name);
    setRenaming(false);
  };

  return (
    <li className="inner flex flex-col gap-3 p-4" data-testid="bench-object" data-kind={obj.kind} data-near={obj.near}>
      <div className="flex items-center gap-3">
        <span className="relative shrink-0">
          <IconTile area={obj.area} size={40} />
          {last && <span key={last.at} className="pulse-ring" style={{ ['--ring' as string]: last.tone === 'bad' ? 'rgba(201,48,61,0.8)' : 'rgba(255,172,0,0.85)' }} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input ref={inputRef} autoFocus defaultValue={obj.name} aria-label={t('bench.rename')} className="field-input !h-9 !px-3" onBlur={commitRename} onKeyDown={(e) => (e.key === 'Enter' ? commitRename() : e.key === 'Escape' ? (e.stopPropagation(), setRenaming(false)) : undefined)} data-testid="rename-input" />
          ) : (
            <h3 className="break-words text-[17px] leading-snug" title={obj.name} data-testid="object-name">
              {obj.name}
            </h3>
          )}
          <p className="tag m-0 mt-0.5 !text-[11px]">{t(kind.labelKey)}</p>
        </div>
        <div className="-mr-2 shrink-0">
          <MenuButton
            label={t('bench.objectMenu', { name: obj.name })}
            testid="object-menu"
            entries={[
              { id: 'rename', label: t('bench.rename'), icon: 'pencil', onSelect: () => setRenaming(true) },
              ...(kind.single ? [] : [{ id: 'duplicate', label: t('bench.duplicate'), icon: 'copy' as const, onSelect: () => bench.duplicate(obj.id, t('bench.copy')) }]),
              { id: 'delete', label: t('bench.delete'), icon: 'trash', danger: true, onSelect: () => bench.remove(obj.id) },
            ]}
          />
        </div>
      </div>

      <View obj={obj} />

      {(kind.actions?.length || presence) && (
        <div className="flex flex-wrap items-center gap-2">
          {kind.actions?.map((a) => (
            <button key={a.key} type="button" className="btn btn-sm" disabled={!obj.near} title={obj.near ? undefined : t('bench.needActive')} data-testid={`action-${a.key}`} onClick={() => kind.run?.({ device }, obj, a.key)}>
              {t(a.labelKey)}
            </button>
          ))}
          <div className="flex-1" />
          {presence && (
            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold">
              <span data-testid="near-state">{t(obj.near ? presence.on : presence.off)}</span>
              <input type="checkbox" className="switch" checked={obj.near} data-testid="toggle-near" onChange={() => bench.setNear(obj.id, !obj.near)} />
            </label>
          )}
        </div>
      )}
    </li>
  );
}
