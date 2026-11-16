import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { AppsList } from './AppsList';
import { BenchPanel } from './BenchPanel';
import { ComponentsPanel } from './ComponentsPanel';
import { ConsolePanel } from './ConsolePanel';
import { LanguageSelect, MockToggle, RunButtons, ThemeButton } from './Controls';
import { Brand } from './TopBar';

type Tab = 'bench' | 'components' | 'console' | 'apps' | 'settings';
const TABS: Tab[] = ['bench', 'components', 'console', 'apps', 'settings'];

/** Phone UI: one small handle outside the device art opens a sheet (bottom in portrait, side in landscape). */
export function Sheet({ landscape }: { landscape: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('bench');
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus({ preventScroll: true });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <>
      <button
        type="button"
        data-testid="sheet-handle"
        aria-label={t('sheet.open')}
        aria-expanded={open}
        aria-controls="sheet"
        onClick={() => setOpen(true)}
        className={`absolute z-20 flex items-center justify-center bg-transparent ${landscape ? 'right-0 top-1/2 h-24 w-11 -translate-y-1/2' : 'inset-x-0 bottom-0 h-11'}`}
        style={landscape ? { right: 'env(safe-area-inset-right)' } : { paddingBottom: 'env(safe-area-inset-bottom)', height: 'calc(44px + env(safe-area-inset-bottom))' }}
      >
        <span aria-hidden className={`rounded-full bg-ink3/70 ${landscape ? 'h-10 w-1' : 'h-1 w-10'}`} />
      </button>

      {open && <div className="absolute inset-0 z-30 bg-black/40" onPointerDown={() => setOpen(false)} aria-hidden data-testid="sheet-backdrop" />}

      <aside
        id="sheet"
        role="dialog"
        aria-modal="false"
        aria-label={t('sheet.title')}
        aria-hidden={!open}
        // @ts-expect-error inert is valid HTML, missing from this React typing
        inert={!open ? '' : undefined}
        data-testid="sheet"
        data-open={open}
        className={`absolute z-40 flex min-h-0 flex-col overflow-hidden border-line2 bg-panel shadow-2xl transition-transform duration-200 ${
          landscape ? 'bottom-0 right-0 top-0 w-[min(26rem,62vw)] border-l' : 'inset-x-0 bottom-0 h-[78dvh] rounded-t-2xl border-t'
        } ${open ? 'translate-x-0 translate-y-0' : landscape ? 'translate-x-full' : 'translate-y-full'}`}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', paddingRight: landscape ? 'env(safe-area-inset-right)' : undefined, paddingTop: landscape ? 'env(safe-area-inset-top)' : undefined }}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <Brand />
          <div className="flex-1" />
          <button ref={closeBtn} type="button" className="btn" onClick={() => setOpen(false)} data-testid="sheet-close" aria-label={t('sheet.close')}>
            ✕
          </button>
        </div>
        <div role="tablist" aria-label={t('sheet.title')} className="scroll-thin flex gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
          {TABS.map((id) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} className={`btn shrink-0 ${tab === id ? 'is-on' : 'btn-ghost'}`} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
              {t(`nav.${id}` as 'nav.bench')}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col" role="tabpanel">
          {tab === 'bench' && <BenchPanel />}
          {tab === 'components' && <ComponentsPanel />}
          {tab === 'console' && <ConsolePanel />}
          {tab === 'apps' && (
            <div className="scroll-thin flex flex-col gap-3 overflow-y-auto p-3">
              <div className="flex flex-wrap gap-2">
                <RunButtons />
              </div>
              <AppsList />
            </div>
          )}
          {tab === 'settings' && <Settings />}
        </div>
      </aside>
    </>
  );
}

function Settings() {
  const { t } = useI18n();
  const { viewMode, setViewMode, glFailed, wakeLock, setWakeLock } = useHost();
  return (
    <div className="scroll-thin flex flex-col gap-4 overflow-y-auto p-3">
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{t('device.view')}</span>
        <div className="flex">
          <button type="button" className="btn rounded-r-none" aria-pressed={viewMode === '3d'} disabled={glFailed} onClick={() => setViewMode('3d')} data-testid="settings-view-3d">
            3D
          </button>
          <button type="button" className="btn -ml-px rounded-l-none" aria-pressed={viewMode === '2d'} onClick={() => setViewMode('2d')} data-testid="settings-view-2d">
            2D
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{t('lang.label')}</span>
        <LanguageSelect />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="eyebrow">{t('settings.appearance')}</span>
        <div>
          <ThemeButton />
        </div>
      </div>
      <label className="flex items-start gap-2 text-[12px] text-ink2">
        <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={wakeLock} onChange={(e) => setWakeLock(e.target.checked)} />
        <span>
          {t('settings.wake')}
          <span className="block text-[11px] text-ink3">{t('settings.wake.hint')}</span>
        </span>
      </label>
      <MockToggle />
    </div>
  );
}
