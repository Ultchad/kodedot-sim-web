import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { poseOf, MOTION_KIND } from '../bench/motion';
import { useBenchState } from '../state/bench';
import { useI18n } from '../i18n';
import { isPhone } from '../lib/layout';
import { KEY_HINT } from '../lib/keys';
import { ZERO_POSE } from '../lib/pose';
import { loadPref, savePref } from '../lib/prefs';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { Device2D } from './Device2D';

const Device3D = lazy(() => import('./Device3D'));

let glProbe: boolean | null = null;
export function webglAvailable(): boolean {
  if (glProbe !== null) return glProbe;
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    glProbe = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    glProbe = false;
  }
  return glProbe;
}

export function useReducedMotion(): boolean {
  const [rm, setRm] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setRm(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return rm;
}

class Boundary extends Component<{ onError(): void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Zoom2D = 'fit' | 1 | 2 | 3;

export function DevicePane() {
  const { t } = useI18n();
  const host = useHost();
  const { layout, viewMode, device, painter } = host;
  const phone = isPhone(layout);
  const reduced = useReducedMotion();
  const [zoom2d, setZoom2d] = useState<Zoom2D>(() => {
    const z = loadPref<unknown>('dotbench.zoom2d', 1);
    return z === 'fit' || z === 2 || z === 3 ? z : 1;
  });
  const [resetSignal, setResetSignal] = useState(0);

  // WebGL unavailable => 2D for this session
  useEffect(() => {
    if (viewMode === '3d' && !host.glFailed && !webglAvailable()) host.reportGlFailure('unavailable');
  }, [viewMode, host]);

  const benchState = useBenchState(host.bench);
  const active = benchState.slots.motion ? benchState.objects.find((o) => o.id === benchState.slots.motion && o.kind === MOTION_KIND) : undefined;
  const storePose = active ? poseOf(active) : ZERO_POSE;

  const pickZoom = (z: Zoom2D) => {
    setZoom2d(z);
    savePref('dotbench.zoom2d', z);
  };

  const showToolbar = !phone || viewMode === '3d';
  const show3d = viewMode === '3d' && !host.glFailed;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('device.region')}>
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-b border-line px-3 py-2" role="toolbar" aria-label={t('device.view')}>
          <div className="flex" role="group" aria-label={t('device.view')}>
            <button type="button" className="btn rounded-r-none" aria-pressed={show3d} disabled={host.glFailed} onClick={() => host.setViewMode('3d')} data-testid="view-3d">
              3D
            </button>
            <button type="button" className="btn -ml-px rounded-l-none" aria-pressed={!show3d} onClick={() => host.setViewMode('2d')} data-testid="view-2d">
              2D
            </button>
          </div>
          {show3d ? (
            <>
              <button type="button" className="btn" onClick={() => setResetSignal((n) => n + 1)} data-testid="recenter">
                {t('device.recenter')}
              </button>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink2">
                <input
                  type="checkbox"
                  checked={host.tiltLink}
                  data-testid="tilt-link"
                  onChange={(e) => {
                    host.setTiltLink(e.target.checked);
                    if (e.target.checked && !host.bench.activeIn('motion')) host.applyPose(ZERO_POSE);
                  }}
                  className="accent-[var(--accent)]"
                />
                {t('device.tilt')}
              </label>
            </>
          ) : (
            !phone && (
              <div className="flex" role="group" aria-label={t('device.zoom')}>
                {([1, 2, 3, 'fit'] as const).map((z, i) => (
                  <button key={z} type="button" aria-pressed={zoom2d === z} className={`btn ${i ? '-ml-px' : ''} ${i === 0 ? 'rounded-r-none' : i === 3 ? 'rounded-l-none' : 'rounded-none'}`} onClick={() => pickZoom(z)}>
                    {z === 'fit' ? t('device.fit') : `${z}×`}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1" style={phone ? { padding: 'env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)' } : undefined}>
        {show3d ? (
          <Boundary onError={() => host.reportGlFailure('unavailable')}>
            <Suspense fallback={<div className="m-auto font-mono text-[11px] text-ink3">{t('device.loading3d')}</div>}>
              <Device3D
                device={device}
                input={host.input}
                painter={painter}
                storePose={storePose}
                tiltLink={host.tiltLink}
                onPose={host.applyPose}
                resetSignal={resetSignal}
                reducedMotion={reduced}
                onContextLost={() => host.reportGlFailure('lost')}
              />
            </Suspense>
          </Boundary>
        ) : (
          <Device2D zoom={phone ? 'fit' : zoom2d} crop={phone} />
        )}
      </div>

      {!phone && <Hud show3d={show3d} />}
    </section>
  );
}

function Hud({ show3d }: { show3d: boolean }) {
  const { t, fmt } = useI18n();
  const { device } = useHost();
  const led = useObservable(device.led);
  const haptic = useObservable(device.haptic);
  const backlight = useObservable(device.backlight);
  const panelOn = useObservable(device.panelOn);
  const on = led.r + led.g + led.b > 0;
  const rgb = `rgb(${led.r}, ${led.g}, ${led.b})`;
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-line px-3 py-2 font-mono text-[11px] text-ink2">
      <span className="flex items-center gap-2" title={t('hud.led')}>
        <span className="eyebrow">{t('hud.led')}</span>
        <span
          data-testid="led"
          data-color={rgb}
          role="img"
          aria-label={`${t('hud.led')} ${on ? rgb : t('hud.off')}`}
          className="inline-block h-3 w-3 rounded-full border border-line2"
          style={{ background: on ? rgb : 'transparent', boxShadow: on ? `0 0 10px 2px ${rgb}` : 'none' }}
        />
      </span>
      <span className="flex items-center gap-2">
        <span className="eyebrow">{t('hud.haptic')}</span>
        <span className="relative h-1.5 w-14 overflow-hidden rounded-full bg-panel2" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(haptic.toFixed(2))} aria-label={t('hud.haptic')}>
          <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${haptic * 100}%` }} />
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="eyebrow">{t('hud.backlight')}</span>
        <span data-testid="backlight">{panelOn ? `${fmt.number(backlight)}%` : t('hud.off')}</span>
      </span>
      <span className="hidden text-ink3 xl:inline">
        {t('hud.keys', { top: KEY_HINT.top, bottom: KEY_HINT.bottom, arrows: '← ↑ ↓ →' })}
        {show3d ? ` · ${t('device.hint3d')}` : ''}
      </span>
    </div>
  );
}
