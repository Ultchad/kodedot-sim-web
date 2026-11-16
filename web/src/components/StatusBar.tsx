import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { useObservable, useTick } from '../state/hooks';

const DOT: Record<string, string> = { idle: 'bg-ink3', booting: 'bg-accent', running: 'bg-ok', crashed: 'bg-bad' };

export function StatusBar() {
  const { t, fmt } = useI18n();
  const { device, painter } = useHost();
  const status = useObservable(device.status);
  const app = useObservable(device.appName);
  useTick(500);
  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;

  return (
    <footer className="flex flex-wrap items-center gap-x-5 gap-y-0.5 border-t border-line bg-panel px-3 py-1.5 font-mono text-[11px] text-ink2" data-testid="status-bar" style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}>
      <Item label={t('status.app')} value={app ?? t('status.noApp')} testid="status-app" />
      <span className="flex items-center gap-1.5">
        <span className="eyebrow">{t('status.state')}</span>
        <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${DOT[status]}`} />
        <span data-testid="status-state" data-status={status}>
          {t(`status.${status}` as 'status.idle')}
        </span>
      </span>
      <Item label={t('status.fps')} value={String(painter.fps)} testid="status-fps" />
      <Item label={t('status.time')} value={fmt.time(device.time())} />
      <Item label={t('status.device')} value={device.info.label} />
      <span className="flex items-center gap-1.5" title={t('status.isolated.hint')}>
        <span className="eyebrow">{t('status.isolated')}</span>
        <span data-testid="status-isolated" data-value={isolated} className={isolated ? 'text-ok' : 'text-bad'}>
          {t(isolated ? 'status.yes' : 'status.no')}
        </span>
      </span>
    </footer>
  );
}

function Item({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className="truncate" data-testid={testid}>
        {value}
      </span>
    </span>
  );
}
