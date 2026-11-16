import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { AppsList } from './AppsList';
import { LanguageSelect, MockToggle, RunButtons, ThemeButton } from './Controls';

export function Brand() {
  return (
    <span className="flex items-center gap-2 font-mono text-[13px] font-semibold tracking-tight">
      <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
        <rect x="9" y="4" width="14" height="24" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <circle cx="16" cy="22" r="2.4" fill="var(--accent)" />
      </svg>
      dotbench
    </span>
  );
}

export function TopBar({ drawers }: { drawers?: { bench: boolean; console: boolean; toggle(which: 'bench' | 'console'): void } }) {
  const { t } = useI18n();
  const { device, selectedId, bundles } = useHost();
  const app = useObservable(device.appName);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const sel = bundles.find((b) => b.id === selectedId);

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-3 py-2" data-testid="top-bar">
      <Brand />
      {drawers && (
        <button type="button" className="btn" aria-pressed={drawers.bench} onClick={() => drawers.toggle('bench')} data-testid="drawer-bench">
          {t('nav.bench')}
        </button>
      )}
      <div ref={wrap} className="relative">
        <button type="button" className="btn max-w-[16rem]" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} data-testid="apps-menu">
          <span className="eyebrow">{t('nav.apps')}</span>
          <span className="truncate">{sel?.name ?? app ?? t('apps.none')}</span>
          <span aria-hidden>▾</span>
        </button>
        {open && (
          <div role="dialog" aria-label={t('apps.title')} className="absolute left-0 top-full z-40 mt-1 w-80 max-w-[92vw] rounded-lg border border-line2 bg-panel p-3 shadow-xl" data-testid="apps-popover">
            <AppsList />
          </div>
        )}
      </div>
      <RunButtons />
      <div className="flex-1" />
      <MockToggle />
      <LanguageSelect />
      <ThemeButton />
      {drawers && (
        <button type="button" className="btn" aria-pressed={drawers.console} onClick={() => drawers.toggle('console')} data-testid="drawer-console">
          {t('nav.console')}
        </button>
      )}
    </header>
  );
}
