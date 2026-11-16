import { LOCALES, useI18n, type Locale } from '../i18n';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';

export function LanguageSelect({ className = '' }: { className?: string }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <select aria-label={t('lang.label')} value={locale} onChange={(e) => setLocale(e.target.value as Locale)} className={`field-input !w-auto ${className}`} data-testid="lang-select">
      {LOCALES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

export function ThemeButton() {
  const { t } = useI18n();
  const { theme, toggleTheme } = useHost();
  return (
    <button type="button" className="btn" onClick={toggleTheme} aria-label={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')} title={t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark')} data-testid="theme-toggle">
      <span aria-hidden>{theme === 'dark' ? '☀' : '☾'}</span>
      <span className="hidden xl:inline">{t(theme === 'dark' ? 'theme.light' : 'theme.dark')}</span>
    </button>
  );
}

export function MockToggle() {
  const { t } = useI18n();
  const { useMock, setUseMock } = useHost();
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink2" title={t('mock.hint')}>
      <input type="checkbox" checked={useMock} onChange={(e) => setUseMock(e.target.checked)} data-testid="mock-toggle" className="accent-[var(--accent)]" />
      {t('mock.label')}
    </label>
  );
}

export function RunButtons() {
  const { t } = useI18n();
  const { device, restart, stop } = useHost();
  const status = useObservable(device.status);
  return (
    <>
      <button type="button" className="btn" onClick={() => void restart()} data-testid="restart">
        {t('top.restart')}
      </button>
      <button type="button" className="btn" onClick={stop} disabled={status === 'idle'} data-testid="stop">
        {t('top.stop')}
      </button>
    </>
  );
}
