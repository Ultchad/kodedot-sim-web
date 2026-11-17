import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { getKind } from '../bench/kinds';
import { poseOf, MOTION_KIND } from '../bench/drivers/motion';
import { customModel } from '../device3d/customModel';
import { useBenchState } from '../state/bench';
import { useI18n } from '../i18n';
import { isPhone } from '../lib/layout';
import { ZERO_POSE } from '../lib/pose';
import { loadPref, savePref } from '../lib/prefs';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import type { PanelId, PanelPlacement } from '../lib/layout';
import { Device2D } from './Device2D';
import { DeviceStatusCard } from './DeviceStatusCard';
import { Icon } from './Glyphs';
import { ModelOffer } from './ModelControls';
import { NoticeBanner } from './Notice';

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

/**
 * The 3D canvas releases its WebGL context when it unmounts (switching to 2D). That is not a failure, so "context lost"
 * only counts while this wrapper is mounted.
 */
function Live3D(props: ComponentProps<typeof Device3D>) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return (
    <Device3D
      {...props}
      onContextLost={() => {
        if (alive.current) props.onContextLost();
      }}
    />
  );
}

type Zoom2D = 'fit' | 1 | 2 | 3;
const ZOOMS: readonly Zoom2D[] = ['fit', 1, 2, 3];

export interface PanelControl {
  open: boolean;
  placement: PanelPlacement;
  toggle(): void;
}

/** Opens or closes a side card. It sits at the end of the stage toolbar on the card's own side. */
function PanelToggle({ id, ctl }: { id: PanelId; ctl: PanelControl }) {
  const { t } = useI18n();
  const label = t(id === 'bench' ? 'nav.bench' : 'nav.console');
  const hint = t(ctl.open ? 'panel.hide' : 'panel.show', { panel: label });
  return (
    <button type="button" className="chip" aria-expanded={ctl.open} aria-controls={`panel-${id}`} aria-label={hint} title={hint} onClick={ctl.toggle} data-testid={`drawer-${id}`}>
      <Icon name={id === 'bench' ? 'panelLeft' : 'panelRight'} className={id === 'console' ? 'order-2' : ''} />
      <span className={ctl.open ? 'hidden @[900px]:inline' : 'hidden @[560px]:inline'}>{label}</span>
    </button>
  );
}

export function DevicePane({ panels }: { panels?: Record<PanelId, PanelControl> }) {
  const { t } = useI18n();
  const host = useHost();
  const { layout, viewMode, device, painter } = host;
  const phone = isPhone(layout);
  const benchState = useBenchState(host.bench);
  const reduced = useReducedMotion();
  const [zoom2d, setZoom2d] = useState<Zoom2D>(() => {
    const z = loadPref<unknown>('dotbench.zoom2d', 'fit');
    return z === 1 || z === 2 || z === 3 ? z : 'fit';
  });
  const [resetSignal, setResetSignal] = useState(0);

  // WebGL unavailable => 2D for this session
  useEffect(() => {
    if (viewMode === '3d' && !host.glFailed && !webglAvailable()) host.reportGlFailure('unavailable');
  }, [viewMode, host]);

  const active = benchState.objects.find((o) => o.near && o.kind === MOTION_KIND);
  const storePose = active ? poseOf(active) : ZERO_POSE;

  const pickZoom = (z: Zoom2D) => {
    setZoom2d(z);
    savePref('dotbench.zoom2d', z);
  };

  const workbench = host.mode === 'workbench';
  const showToolbar = !phone || viewMode === '3d' || workbench;
  // the Workbench is always the 3D scene; the device alone can be either
  const show3d = (workbench || viewMode === '3d') && !host.glFailed;
  useEffect(() => {
    if (workbench && !host.glFailed && !webglAvailable()) host.reportGlFailure('unavailable');
  }, [workbench, host]);
  const tRef = useRef(t);
  tRef.current = t;
  const world = useMemo(
    () => ({
      bench: host.bench,
      live: host.live,
      runtime: host.runtime,
      device,
      select: host.select,
      bus: host.bus,
      applyPose: host.applyPose,
      nameFor: (kind: string) => {
        const k = getKind(kind);
        return k ? `${tRef.current(k.labelKey)} ${host.bench.countOf(kind) + 1}` : kind;
      },
    }),
    [host.bench, host.live, host.runtime, device, host.select, host.bus, host.applyPose],
  );
  const benchUndo = benchState.undo;
  const benchRedo = benchState.redo;
  // the bundled model is fetched while the 3D code itself is still loading, so the two arrive together
  useEffect(() => {
    if (show3d) void customModel.ensureBundled();
  }, [show3d]);
  // Once the 3D view has been shown it stays mounted, hidden, while the 2D view is on: going back to 3D is then
  // instant (no new WebGL context, no shaders to compile again). A hidden canvas draws nothing. Not on phones, where
  // an idle WebGL context is the first thing the system takes away.
  const [kept3d, setKept3d] = useState(false);
  useEffect(() => {
    if (show3d && !phone) setKept3d(true);
    if (phone || host.glFailed) setKept3d(false);
  }, [show3d, phone, host.glFailed]);
  const mount3d = show3d || (kept3d && !phone && !host.glFailed);
  const showRef = useRef(show3d);
  showRef.current = show3d;

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={t('device.region')}>
      {showToolbar && (
        <div className={`@container flex shrink-0 items-center gap-2 ${phone ? 'justify-center px-2 py-2' : 'relative z-[35] h-[60px] px-2'}`} role="toolbar" aria-label={t('device.view')} style={phone ? { paddingTop: 'max(8px, env(safe-area-inset-top))' } : undefined}>
          {panels && <PanelToggle id="bench" ctl={panels.bench} />}
          <div className={`flex min-w-0 items-center justify-center gap-2 ${phone ? '' : 'flex-1'}`}>
            <div className="seg" role="group" aria-label={t('mode.label')}>
              <button type="button" className="chip" aria-pressed={!workbench} title={t('mode.device.hint')} onClick={() => host.setMode('device')} data-testid="mode-device">
                <Icon name="device" />
                <span className="hidden @[700px]:inline">{t('mode.device')}</span>
              </button>
              <button type="button" className="chip" aria-pressed={workbench} disabled={host.glFailed} title={host.glFailed ? t('device.glFallback') : t('mode.workbench.hint')} onClick={() => host.setMode('workbench')} data-testid="mode-workbench">
                <Icon name="table" />
                <span className="hidden @[700px]:inline">{t('mode.workbench')}</span>
              </button>
            </div>
            {workbench ? (
              <div className="flex items-center gap-2" role="group" aria-label={t('wb.toolbar')} data-testid="wb-tools">
                <button type="button" className="chip" onClick={() => host.bus.send({ type: 'focus-dot' })} data-testid="wb-focus-dot" aria-label={t('wb.focusDot')} title={t('wb.focusDot')}>
                  <Icon name="target" />
                  <span className="hidden @[940px]:inline">{t('wb.focusDot')}</span>
                </button>
                <button type="button" className="chip" onClick={() => host.bus.send({ type: 'frame-all' })} data-testid="wb-frame-all" aria-label={t('wb.wholeTable')} title={t('wb.wholeTable')}>
                  <Icon name="recenter" />
                  <span className="hidden @[940px]:inline">{t('wb.wholeTable')}</span>
                </button>
                <div className="seg" role="group">
                  <button type="button" className="chip" disabled={!benchUndo} onClick={() => host.bench.undo()} data-testid="wb-undo" aria-label={t('wb.undo')} title={`${t('wb.undo')} (Ctrl+Z)`}>
                    <Icon name="undo" />
                  </button>
                  <button type="button" className="chip" disabled={!benchRedo} onClick={() => host.bench.redo()} data-testid="wb-redo" aria-label={t('wb.redo')} title={`${t('wb.redo')} (Ctrl+Shift+Z)`}>
                    <Icon name="redo" />
                  </button>
                </div>
              </div>
            ) : (
            <>
            <div className="seg" role="group" aria-label={t('device.view')}>
              <button type="button" className="chip" aria-pressed={show3d} disabled={host.glFailed} title={host.glFailed ? t('device.glFallback') : undefined} onClick={() => host.setViewMode('3d')} data-testid="view-3d">
                3D
              </button>
              <button type="button" className="chip" aria-pressed={!show3d} onClick={() => host.setViewMode('2d')} data-testid="view-2d">
                2D
              </button>
            </div>
            {show3d ? (
              <>
                <button type="button" className="chip" onClick={() => setResetSignal((n) => n + 1)} data-testid="recenter" aria-label={t('device.recenter')} title={t('device.recenter')}>
                  <Icon name="recenter" />
                  <span className="hidden @[940px]:inline">{t('device.recenter')}</span>
                </button>
                <label className="pill h-[var(--compact-h)] cursor-pointer !gap-2 !pl-1.5" title={t('device.tilt.hint')}>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={host.tiltLink}
                    data-testid="tilt-link"
                    aria-label={t('device.tilt.hint')}
                    onChange={(e) => {
                      host.setTiltLink(e.target.checked);
                      if (e.target.checked && !host.bench.activeIn('motion')) host.applyPose(ZERO_POSE);
                    }}
                  />
                  <span className="hidden font-semibold @[860px]:inline">{t('device.tilt')}</span>
                </label>
              </>
            ) : (
              !phone && (
                <div className="seg" role="group" aria-label={t('device.zoom')} data-testid="zoom-group">
                  {ZOOMS.map((z) => (
                    <button key={z} type="button" aria-pressed={zoom2d === z} className="chip" title={z === 'fit' ? t('device.fit.hint') : t('device.zoom.hint', { zoom: z })} onClick={() => pickZoom(z)} data-testid={`zoom-${z}`}>
                      {z === 'fit' ? t('device.fit') : `${z}×`}
                    </button>
                  ))}
                </div>
              )
            )}
            </>
            )}
          </div>
          {panels && <PanelToggle id="console" ctl={panels.console} />}
        </div>
      )}

      <div className="relative flex min-h-0 min-w-0 flex-1" data-testid="stage" style={phone ? { padding: `${showToolbar ? '0px' : 'env(safe-area-inset-top)'} env(safe-area-inset-right) 0 env(safe-area-inset-left)` } : undefined}>
        {mount3d && (
          <div className={show3d ? 'anim-fade flex min-h-0 min-w-0 flex-1' : 'hidden'} data-testid="stage-3d" data-shown={show3d} data-mode={workbench ? 'workbench' : 'device'}>
            <Boundary onError={() => host.reportGlFailure('unavailable')}>
              <Suspense fallback={<div className="m-auto text-[14px] text-ink2">{t('device.loading3d')}</div>}>
                <Live3D
                  device={device}
                  input={host.input}
                  painter={painter}
                  storePose={storePose}
                  tiltLink={host.tiltLink}
                  onPose={host.applyPose}
                  resetSignal={resetSignal}
                  reducedMotion={reduced}
                  mode={workbench ? 'workbench' : 'device'}
                  world={world}
                  dark={host.theme === 'dark'}
                  // a context lost while the view is only kept in reserve is not a failure: let go of it quietly
                  onContextLost={() => (showRef.current ? host.reportGlFailure('lost') : setKept3d(false))}
                />
              </Suspense>
            </Boundary>
          </div>
        )}
        {!show3d && <Device2D zoom={phone ? 'fit' : zoom2d} crop={phone} inset={phone ? 0 : 8} />}
        <DeviceStatusCard />
        <ModelOffer />
        <NoticeBanner />
      </div>
      {!phone && <WelcomeHint />}
    </section>
  );
}

/**
 * First visit only: says that the Dot is live and how to use it: unlock kodeOS, open its app list, tap an app, hold
 * the bottom button to come back, and how to install one's own. It never
 * covers the device: under it on desktop, on top of the bottom bar on a phone, inside the side panel in phone landscape.
 * Gone for good with "Got it", or once an own app was installed.
 */
export function WelcomeHint({ variant = 'desk' }: { variant?: 'desk' | 'bar' | 'panel' }) {
  const { t } = useI18n();
  const { welcome, dismissWelcome, requestApps, device } = useHost();
  const status = useObservable(device.status);
  // "This Dot is live" is only true while it runs; a stopped or crashed Dot has its own card on the stage
  if (!welcome || status === 'idle' || status === 'crashed') return null;
  if (variant !== 'desk') {
    return (
      <aside className={`anim-rise shrink-0 ${variant === 'panel' ? 'px-3 pb-2' : 'px-3'}`} aria-label={t('welcome.title')} data-testid="welcome">
        <div className="inner flex items-center gap-2 py-1.5 pl-4 pr-1.5">
          <p className="m-0 min-w-0 flex-1 text-[13.5px] leading-snug">
            <strong className="font-semibold">{t('welcome.title')}</strong> {t(variant === 'panel' ? 'welcome.body.side' : 'welcome.body.phone')}
          </p>
          <button type="button" className="btn btn-sm btn-primary shrink-0" onClick={dismissWelcome} data-testid="welcome-dismiss">
            {t('welcome.dismiss')}
          </button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="anim-rise shrink-0 pb-1 pt-2" aria-label={t('welcome.title')} data-testid="welcome">
      <div className="inner mx-auto flex max-w-[44rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <p className="m-0 min-w-[14rem] flex-1 text-[14px] leading-snug">
          <strong className="font-semibold">{t('welcome.title')}</strong> {t('welcome.body')}
        </p>
        <div className="flex shrink-0 gap-2">
          <button type="button" className="btn btn-sm" onClick={requestApps} data-testid="welcome-open">
            {t('welcome.open')}
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={dismissWelcome} data-testid="welcome-dismiss">
            {t('welcome.dismiss')}
          </button>
        </div>
      </div>
    </aside>
  );
}
