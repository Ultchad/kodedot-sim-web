import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { appLabel, useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { AppsList } from './AppsList';
import { DeviceActions } from './DeviceMenu';
import { LanguageSelect, MockToggle, RunButtons, ThemeChoice } from './Controls';
import { Icon } from './Glyphs';
import { ModelControls } from './ModelControls';
import { Popover } from './ui';
import { GuideButton } from '../guide/entry';
import { REPO_URL } from '../guide/content';

/** The product's name as shown to people, the same in every language. Internal identifiers (.dotbench packages, storage keys) keep the old name for now. */
export const PRODUCT_NAME = 'KodeDot Sim';

export function Brand() {
  return (
    // plain text in the heading face: a name, not a logo
    <h1 className="shrink-0 whitespace-nowrap text-[24px] leading-none" data-testid="brand">
      {PRODUCT_NAME}
    </h1>
  );
}

/** One quiet line that says what this page is. */
export function About() {
  const { t } = useI18n();
  return (
    <p className="m-0 text-[13px] leading-snug text-ink2" data-testid="about">
      <strong className="font-semibold text-ink">{PRODUCT_NAME}</strong> · {t('app.descriptor')}
      <span className="mt-1 block xl:hidden">
        {t('app.unofficial')}{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-semibold text-ink underline underline-offset-2">
          {t('app.source')}
        </a>
      </span>
    </p>
  );
}

/** A quiet line in the top bar's empty middle: this is a community project, not Kode's (the owner asked for it there). */
export function Unofficial({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p className={`m-0 min-w-0 truncate text-center text-[12.5px] leading-snug text-ink2 ${className}`} data-testid="unofficial">
      {t('app.unofficial')}{' '}
      <a href={REPO_URL} target="_blank" rel="noreferrer" className="font-semibold text-ink underline decoration-hair underline-offset-2 hover:decoration-current">
        {t('app.source')}
      </a>
    </p>
  );
}

/** Name of what runs on the Dot (kodeOS or the open app), or null while it is off. */
export function useCurrentAppName(): string | null {
  const { device } = useHost();
  const app = useObservable(device.appName);
  return app ? appLabel(app) : null;
}

/** True while what runs is the system itself (kodeOS), not an app. */
export function useSystemRunning(): boolean {
  return useHost().program?.kind === 'os';
}

/** The Dot's app manager: what runs, what is installed, install, go home, factory reset. */
function AppPicker() {
  const { t } = useI18n();
  const { appsRequest } = useHost();
  const name = useCurrentAppName();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const seen = useRef(appsRequest);
  useEffect(() => {
    if (appsRequest !== seen.current) {
      seen.current = appsRequest;
      setOpen(true);
    }
  }, [appsRequest]);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="btn min-w-0 !shrink max-w-[19rem]"
        aria-expanded={open}
        aria-haspopup="dialog"
        title={name ? t('apps.pickerHint', { name }) : t('apps.title')}
        onClick={() => setOpen((o) => !o)}
        data-testid="apps-menu"
      >
        <span className="font-medium text-ink2">{t('apps.pickerLabel')}</span>
        <span className="truncate" data-testid="apps-menu-running">
          {name ?? t('apps.none')}
        </span>
        <Icon name="chevronDown" size={16} className="text-ink2" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label={t('apps.title')} width="23rem" testid="apps-popover">
        <AppsList onRun={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function DeviceMenu() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} data-testid="device-menu">
        {t('device.menu')}
        <Icon name="chevronDown" size={16} className="text-ink2" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label={t('device.menu')} width="24rem" align="end" testid="device-popover">
        <div className="flex flex-col gap-4">
          <ModelControls onDone={() => setOpen(false)} />
          <DeviceActions onDone={() => setOpen(false)} />
          <MockToggle />
        </div>
      </Popover>
    </>
  );
}

function SettingsMenu() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="btn btn-icon" aria-expanded={open} aria-haspopup="dialog" aria-label={t('nav.settings')} title={t('nav.settings')} onClick={() => setOpen((o) => !o)} data-testid="settings-menu">
        <Icon name="settings" size={20} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label={t('nav.settings')} width="17rem" align="end" testid="settings-popover">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="tag">{t('lang.label')}</span>
            <LanguageSelect />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="tag">{t('settings.appearance')}</span>
            <ThemeChoice />
          </div>
          <About />
        </div>
      </Popover>
    </>
  );
}

/** One row, never wraps: brand, the app and its run controls on the left; device and page settings on the right. */
export function TopBar() {
  return (
    <header className="flex h-[68px] shrink-0 items-center gap-2 px-4" data-testid="top-bar">
      <Brand />
      <div className="w-1 shrink-0" />
      <AppPicker />
      <RunButtons />
      <div className="flex min-w-0 flex-1 justify-center px-3">
        <Unofficial className="hidden xl:block" />
      </div>
      <GuideButton />
      <DeviceMenu />
      <SettingsMenu />
    </header>
  );
}
