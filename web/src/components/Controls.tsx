import { LOCALES, useI18n, type Locale } from '../i18n';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { Icon } from './Glyphs';

export function LanguageSelect({ className = '' }: { className?: string }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <select aria-label={t('lang.label')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className={`field-input ${className}`} data-testid="lang-select">
      {LOCALES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

/** Light or dark, as a two-way choice (the state is visible, unlike a moon/sun toggle). */
export function ThemeChoice() {
  const { t } = useI18n();
  const { theme, setTheme } = useHost();
  return (
    <div className="seg self-start" role="group" aria-label={t('settings.appearance')} data-testid="theme-toggle">
      {(['light', 'dark'] as const).map((id) => (
        <button key={id} type="button" className="chip" aria-pressed={theme === id} onClick={() => setTheme(id)} data-testid={`theme-${id}`}>
          <Icon name={id === 'light' ? 'sun' : 'moon'} size={16} />
          {t(`theme.${id}` as 'theme.light')}
        </button>
      ))}
    </div>
  );
}

/** The stand-in device: a developer aid, so it lives in the Device menu with its explanation next to it. */
export function MockToggle() {
  const { t } = useI18n();
  const { useMock, setUseMock } = useHost();
  return (
    <label className="flex cursor-pointer items-center gap-3 text-[14px]">
      <input type="checkbox" className="switch" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} data-testid="mock-toggle" />
      <span className="min-w-0">
        <span className="font-semibold">{t('mock.label')}</span>
        <span className="block text-[13px] leading-snug text-ink2">{t('mock.hint')}</span>
      </span>
    </label>
  );
}

/** Restart (or Start, when nothing runs) and Stop. Labels drop to icons on narrow windows; the names stay as tooltips. */
export function RunButtons({ labels = 'auto' }: { labels?: 'auto' | 'always' }) {
  const { t } = useI18n();
  const { device, restart, stop } = useHost();
  const status = useObservable(device.status);
  const idle = status === 'idle';
  const text = labels === 'always' ? '' : 'hidden lg:inline';
  const pad = labels === 'always' ? '' : 'max-lg:w-11 max-lg:px-0';
  const startLabel = t(idle ? 'top.start' : 'top.restart');
  return (
    <>
      <button type="button" className={`btn ${pad}`} onClick={() => void restart()} data-testid="restart" title={startLabel} aria-label={startLabel}>
        <Icon name={idle ? 'play' : 'restart'} />
        <span className={text}>{startLabel}</span>
      </button>
      <button type="button" className={`btn ${pad}`} onClick={stop} disabled={idle} data-testid="stop" title={t('top.stop')} aria-label={t('top.stop')}>
        <Icon name="stop" />
        <span className={text}>{t('top.stop')}</span>
      </button>
    </>
  );
}
