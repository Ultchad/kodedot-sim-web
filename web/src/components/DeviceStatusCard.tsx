import { Atom } from '../device/observable';
import { isRealDevice, type StatusDetail } from '../device/wasm';
import { useI18n, type TKey } from '../i18n';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { Icon } from './Glyphs';
import { ScrollArea } from './ui';
import { useCurrentAppName } from './TopBar';

const IDLE = new Atom<StatusDetail>({ status: 'idle' });

/**
 * Lifecycle feedback, floating over the stage in both views (never inside the small 2D glass, where it was clipped):
 * a quiet pill while loading or booting, and a card with the reason and ONE next action when the app stopped, crashed
 * or cannot run in this browser. The card scrolls inside itself on very short stages.
 */
export function DeviceStatusCard() {
  const { t } = useI18n();
  const { device, restart, launching, requestApps, setUseMock } = useHost();
  const status = useObservable(device.status);
  const name = useCurrentAppName();
  const detail = useObservable(isRealDevice(device) ? device.detail : IDLE);
  const unsupported = isRealDevice(device) ? device.unsupported : [];
  const stop = { onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation() };
  const wrap = 'pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-3';
  const card = 'layer anim-rise pointer-events-auto flex max-h-full w-full max-w-[23rem] flex-col overflow-hidden';
  const layer = { 'data-layer': 'status' };

  if (unsupported.length) {
    return (
      <div className={wrap} data-testid="device-unsupported">
        <div className={card} role="alert" {...layer} {...stop}>
          <ScrollArea className="min-h-0 flex-1 p-5">
            <h3 className="text-[19px] leading-snug">{t('overlay.unsupported.title')}</h3>
            <ul className="mb-2 mt-2 list-disc pl-5 text-[13.5px] leading-snug text-ink2">
              {unsupported.map((p) => (
                <li key={p}>{t(`runtime.problem.${p}` as TKey)}</li>
              ))}
            </ul>
            <p className="m-0 text-[13.5px] leading-snug text-ink2">{t('overlay.unsupported.hint')}</p>
            <button type="button" className="btn btn-primary mt-3" onClick={() => setUseMock(true)} data-testid="unsupported-mock">
              {t('overlay.unsupported.action')}
            </button>
          </ScrollArea>
        </div>
      </div>
    );
  }
  if (status === 'crashed') {
    return (
      <div className={wrap} data-testid="device-crash">
        <div className={card} role="alert" {...layer} {...stop}>
          <ScrollArea className="min-h-0 flex-1 p-5">
            <h3 className="text-[19px] leading-snug">{t('overlay.crash.title')}</h3>
            <p className="mb-0 mt-1 text-[13.5px] leading-snug text-ink2 [overflow-wrap:anywhere]" data-testid="crash-reason">
              {t('overlay.crash.reason', { reason: detail.reason ?? '?' })}
            </p>
            <p className="mb-3 mt-1 text-[13.5px] leading-snug text-ink2">{t('overlay.crash.hint')}</p>
            <button type="button" className="btn btn-primary" onClick={() => void restart()} data-testid="crash-restart">
              <Icon name="restart" />
              {t('overlay.restart')}
            </button>
          </ScrollArea>
        </div>
      </div>
    );
  }
  if (status === 'booting' || (status === 'idle' && launching)) {
    const text = status === 'idle' ? t('overlay.loading') : detail.restarting ? t('overlay.booting.restart', { reason: detail.reason ?? '' }) : t('overlay.booting', { app: name ?? '' });
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-3" data-testid="device-booting">
        <span className="pill anim-rise max-w-full !bg-[#191919]/85 !text-white" role="status">
          <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-primary" />
          <span className="truncate">{text}</span>
        </span>
      </div>
    );
  }
  if (status === 'idle') {
    return (
      <div className={wrap} data-testid="device-idle">
        <div className={card} {...layer} {...stop}>
          <ScrollArea className="min-h-0 flex-1 p-5">
            <h3 className="text-[19px] leading-snug">{t('device.overlay.idle')}</h3>
            <p className="mb-3 mt-1 text-[13.5px] leading-snug text-ink2">{t(name ? 'overlay.idle.hint' : 'overlay.idle.none', { app: name ?? '' })}</p>
            <div className="flex flex-wrap gap-2">
              {name && (
                <button type="button" className="btn btn-primary" onClick={() => void restart()} data-testid="idle-start">
                  <Icon name="play" />
                  {t('top.start')}
                </button>
              )}
              <button type="button" className={`btn ${name ? '' : 'btn-primary'}`} onClick={requestApps} data-testid="idle-apps">
                {t('overlay.idle.choose')}
              </button>
            </div>
          </ScrollArea>
        </div>
      </div>
    );
  }
  return null;
}
