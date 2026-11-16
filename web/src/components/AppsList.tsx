import { useRef } from 'react';
import { builtinKey, describeBuiltin } from '../lib/builtins';
import type { BundleMeta } from '../lib/bundles';
import { useI18n } from '../i18n';
import { appLabel, useHost } from '../state/host';
import { Icon } from './Glyphs';
import { useConfirm } from './ui';

/**
 * The app loader body: "open your own" first (the one thing a visitor comes to do), then saved apps, then the demos.
 * Used in the top-bar picker and in the phone sheet. `onRun` lets the picker close once an app was chosen.
 */
export function AppsList({ onRun }: { onRun?: () => void }) {
  const { t, fmt, locale } = useI18n();
  const { bundles, builtins, selectedId, runBundle, addBundleFile } = useHost();
  const file = useRef<HTMLInputElement>(null);
  const run = (id: string) => {
    void runBundle(id);
    onRun?.();
  };
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[20px]">{t('apps.title')}</h2>

      <section aria-label={t('apps.yours')} className="flex flex-col gap-2">
        <span className="tag">{t('apps.yours')}</span>
        <button type="button" className="btn btn-primary w-full" onClick={() => file.current?.click()} data-testid="open-file">
          <Icon name="open" />
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
            if (f) {
              void addBundleFile(f);
              onRun?.();
            }
          }}
        />
        {bundles.length === 0 ? (
          <p className="m-0 text-[13.5px] leading-snug text-ink2">{t('apps.empty')}</p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="bundle-list">
              {bundles.map((b) => (
                <SavedApp key={b.id} meta={b} on={b.id === selectedId} onRun={() => run(b.id)} />
              ))}
            </ul>
            <p className="m-0 text-[12.5px] text-ink2">{t('apps.count', { count: bundles.length })}</p>
          </>
        )}
      </section>

      {builtins.length > 0 && (
        <section aria-label={t('apps.builtin')} className="flex flex-col gap-2">
          <span className="tag">{t('apps.builtin')}</span>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="builtin-list">
            {builtins.map((b) => {
              const on = builtinKey(b.id) === selectedId;
              return (
                <li key={b.id} className={`rounded-2xl ${on ? 'row-on' : 'bg-soft'}`}>
                  <button type="button" className="row-btn" onClick={() => run(builtinKey(b.id))} aria-label={t('apps.run', { name: b.name })} aria-current={on} data-testid={`builtin-${b.id}`}>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{b.name}</span>
                      {on && <span className="shrink-0 text-[12px] font-semibold">{t('apps.current')}</span>}
                    </span>
                    <span className={`mt-0.5 block text-[13px] leading-snug ${on ? 'opacity-80' : 'text-ink2'}`}>{describeBuiltin(b, locale)}</span>
                    <span className={`mt-0.5 block text-[12px] ${on ? 'opacity-80' : 'text-ink2'}`}>{t('apps.builtin.meta', { size: fmt.bytes(b.size), sdk: b.sdkCommit })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function SavedApp({ meta, on, onRun }: { meta: BundleMeta; on: boolean; onRun(): void }) {
  const { t, fmt } = useI18n();
  const { removeBundle } = useHost();
  const name = appLabel(meta.name);
  const del = useConfirm(() => void removeBundle(meta.id));
  return (
    <li className={`flex items-center gap-1 rounded-2xl ${on ? 'row-on' : 'bg-soft'}`}>
      <button type="button" className="row-btn !w-auto flex-1" onClick={onRun} aria-label={t('apps.run', { name })} aria-current={on} title={meta.name}>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{name}</span>
          {on && <span className="shrink-0 text-[12px] font-semibold">{t('apps.current')}</span>}
        </span>
        <span className={`mt-0.5 block truncate text-[12.5px] ${on ? 'opacity-80' : 'text-ink2'}`}>
          {fmt.bytes(meta.size)} · {fmt.dateTime(meta.addedAt)}
        </span>
      </button>
      <button
        type="button"
        className={`btn btn-sm mr-1.5 ${del.armed ? 'btn-danger !bg-card' : `btn-ghost btn-icon ${on ? '!text-inherit' : ''}`}`}
        aria-label={del.armed ? t('apps.confirmDelete', { name }) : t('apps.delete', { name })}
        title={del.armed ? t('apps.confirmDelete', { name }) : t('apps.delete', { name })}
        onClick={del.press}
        data-testid="bundle-delete"
      >
        {del.armed ? t('bench.confirmDelete') : <Icon name="trash" size={17} />}
      </button>
    </li>
  );
}
