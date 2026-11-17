import { useRef } from 'react';
import type { InstalledApp } from '../device/wasm';
import { useI18n } from '../i18n';
import { appMeta } from '../lib/dotapps';
import { appLabel, useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { Icon } from './Glyphs';
import { useConfirm } from './ui';
import { GuideLink } from '../guide/entry';

/**
 * The Dot's app manager, in the top-bar menu and in the phone sheet. Apps live inside kodeOS: this shows what runs
 * now (with the way home), what is installed (open, remove), installs a .dotbench and, behind a confirmation, erases
 * the Dot. Everything here is also possible on the Dot itself; this is the quick way from the page.
 * `onRun` lets the menu close once something was started. `compact`: the tab above already says "Apps".
 */
export function AppsList({ onRun, compact = false }: { onRun?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const { device, program, apps, installFile, launchApp, goHome, factoryReset, appBusy, useMock } = useHost();
  const status = useObservable(device.status);
  const file = useRef<HTMLInputElement>(null);
  const reset = useConfirm(() => void factoryReset());
  const inApp = program?.kind === 'app';
  const running = program ? appLabel(program.name) : null;
  const busy = appBusy !== null || status === 'booting';

  return (
    <div className="flex flex-col gap-3" data-testid="apps-manager" data-busy={busy}>
      <h2 className={compact ? 'sr-only' : 'text-[20px]'}>{t('apps.title')}</h2>

      {/* what runs now, and the way back to kodeOS */}
      <section aria-label={t('apps.running')} className="flex flex-col gap-2">
        <span className="tag">{t('apps.running')}</span>
        <div className="inner flex min-h-[52px] items-center gap-2 py-1.5 pl-3.5 pr-1.5">
          <span aria-hidden className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${running ? (status === 'running' ? 'bg-ok' : 'bg-primary') : 'bg-ink3'}`} />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold" data-testid="apps-running" title={running ?? undefined}>
            {running ?? t(useMock ? 'status.mock' : 'apps.none')}
          </span>
          {inApp && (
            <button
              type="button"
              className="btn btn-sm shrink-0"
              onClick={() => {
                void goHome();
                onRun?.();
              }}
              title={t('apps.home.hint')}
              data-testid="apps-home"
            >
              <Icon name="home" size={17} />
              {t('apps.home')}
            </button>
          )}
        </div>
      </section>

      <section aria-label={t('apps.installed')} className="flex flex-col gap-2">
        <span className="tag">{t('apps.installed')}</span>
        {apps.length === 0 ? (
          <p className="m-0 px-1 text-[13.5px] leading-snug text-ink2" data-testid="apps-empty">
            {t(useMock ? 'apps.mock' : 'apps.empty')} {!useMock && <GuideLink to="your-own-app" />}
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="app-list">
            {apps.map((a) => (
              <AppRow
                key={a.id}
                app={a}
                on={inApp && program?.id === a.id}
                disabled={busy}
                onOpen={() => {
                  void launchApp(a.id);
                  onRun?.();
                }}
              />
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-primary w-full" disabled={busy || useMock} onClick={() => file.current?.click()} data-testid="open-file">
          <Icon name="open" />
          {t('apps.open')}
        </button>
        <input
          ref={file}
          type="file"
          accept=".zip,.dotbench,application/zip"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) {
              void installFile(f);
              onRun?.();
            }
          }}
        />
        <p className="m-0 px-1 text-[13px] leading-snug text-ink2" role="status" data-testid="apps-hint">
          {appBusy ? (
            t(`apps.busy.${appBusy}` as 'apps.busy.install')
          ) : (
            <>
              {t('apps.install.hint')} <GuideLink to="your-own-app" />
            </>
          )}
        </p>
      </section>

      {!useMock && (
        <section aria-label={t('apps.reset')} className="flex flex-col gap-1.5">
          <span className="tag">{t('apps.reset')}</span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`btn btn-sm ${reset.armed ? 'btn-danger' : ''}`} disabled={appBusy !== null} onClick={reset.press} data-testid="factory-reset" aria-live="polite">
              {!reset.armed && <Icon name="restart" size={17} />}
              {t(reset.armed ? 'apps.reset.confirm' : 'apps.reset.action')}
            </button>
          </div>
          <p className="m-0 px-1 text-[13px] leading-snug text-ink2">{t(reset.armed ? 'apps.reset.warn' : 'apps.reset.hint')}</p>
        </section>
      )}
    </div>
  );
}

function AppRow({ app, on, disabled, onOpen }: { app: InstalledApp; on: boolean; disabled: boolean; onOpen(): void }) {
  const { t } = useI18n();
  const { removeApp } = useHost();
  const name = appLabel(app.name);
  const del = useConfirm(() => void removeApp(app.id));
  const meta = appMeta(app.version, app.category);
  return (
    <li className={`flex items-center gap-1 rounded-2xl ${on ? 'row-on' : 'bg-soft'}`} data-app={app.project}>
      <button type="button" className="row-btn !w-auto flex-1" onClick={onOpen} disabled={disabled || !app.hasBundle} aria-label={t('apps.run', { name })} aria-current={on} title={app.hasBundle ? undefined : t('apps.noBundle')} data-testid={`app-${app.project}`}>
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold">{name}</span>
          {on && <span className="shrink-0 text-[12px] font-semibold">{t('apps.current')}</span>}
        </span>
        {(meta || !app.hasBundle) && <span className={`mt-0.5 block truncate text-[12.5px] ${on ? 'opacity-80' : 'text-ink2'}`}>{app.hasBundle ? meta : t('apps.noBundle')}</span>}
      </button>
      <button
        type="button"
        className={`btn btn-sm mr-1.5 ${del.armed ? 'btn-danger !bg-card' : `btn-ghost btn-icon ${on ? '!text-inherit' : ''}`}`}
        aria-label={del.armed ? t('apps.confirmDelete', { name }) : t('apps.delete', { name })}
        title={del.armed ? t('apps.confirmDelete', { name }) : t('apps.delete', { name })}
        onClick={del.press}
        disabled={disabled}
        data-testid="app-remove"
      >
        {del.armed ? t('bench.confirmDelete') : <Icon name="trash" size={17} />}
      </button>
    </li>
  );
}
