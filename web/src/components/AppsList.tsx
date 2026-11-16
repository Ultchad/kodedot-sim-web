import { useRef } from 'react';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';

/** The app loader body: picker, saved bundles (select, delete, size, date). Used in the top-bar menu and in the phone sheet. */
export function AppsList() {
  const { t, fmt } = useI18n();
  const { bundles, selectedId, runBundle, removeBundle, addBundleFile } = useHost();
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{t('apps.title')}</span>
        <button type="button" className="btn" onClick={() => file.current?.click()} data-testid="open-file">
          {t('apps.open')}
        </button>
        <input
          ref={file}
          type="file"
          accept=".dotbench"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void addBundleFile(f);
          }}
        />
      </div>
      {bundles.length === 0 ? (
        <p className="m-0 text-[12px] text-ink3">{t('apps.empty')}</p>
      ) : (
        <ul className="scroll-thin m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0" data-testid="bundle-list">
          {bundles.map((b) => (
            <li key={b.id} className={`flex items-center gap-1 rounded-md border ${b.id === selectedId ? 'border-accent/70 bg-accent/10' : 'border-line'}`}>
              <button type="button" className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => void runBundle(b.id)} aria-label={t('apps.run', { name: b.name })} aria-current={b.id === selectedId}>
                <div className="truncate text-[12.5px]">{b.name}</div>
                <div className="truncate font-mono text-[10.5px] text-ink3">
                  {fmt.bytes(b.size)} · {fmt.dateTime(b.addedAt)}
                </div>
              </button>
              <button type="button" className="btn btn-ghost mr-1 h-7 px-2" aria-label={t('apps.delete', { name: b.name })} title={t('apps.delete', { name: b.name })} onClick={() => void removeBundle(b.id)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 font-mono text-[10.5px] text-ink3">{t('apps.count', { count: bundles.length })}</p>
    </div>
  );
}
