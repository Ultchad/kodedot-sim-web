import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyPoseToBench, syncBench } from '../bench/sync';
import { BenchStore } from '../bench/store';
import { createDevice, type DeviceKind } from '../device';
import type { KodeDevice } from '../device/types';
import { NotWiredError } from '../device/wasm';
import { useI18n, type TKey } from '../i18n';
import type { Vars } from '../i18n/core';
import { BundleStore, type BundleMeta } from '../lib/bundles';
import { InputController } from '../lib/input';
import { isEditableTarget, keyToButton } from '../lib/keys';
import { isPhone, useLayoutMode, type LayoutMode } from '../lib/layout';
import type { MotionPose } from '../device/motion';
import { loadPref, safeLocal, savePref } from '../lib/prefs';
import { ScreenPainter } from '../lib/screen';
import { SensorBridge, vibrate } from '../lib/sensors';
import { useObservable } from './hooks';

export type ViewMode = '3d' | '2d';
export type Theme = 'dark' | 'light';
export interface Notice {
  id: number;
  kind: 'info' | 'error';
  key: TKey;
  vars?: Vars;
}

export interface Host {
  layout: LayoutMode;
  device: KodeDevice;
  useMock: boolean;
  setUseMock(v: boolean): void;
  input: InputController;
  painter: ScreenPainter;
  bench: BenchStore;

  bundles: BundleMeta[];
  selectedId: string | null;
  addBundleFile(file: File): Promise<void>;
  runBundle(id: string): Promise<void>;
  removeBundle(id: string): Promise<void>;
  restart(): Promise<void>;
  stop(): void;

  notice: Notice | null;
  dismissNotice(): void;

  theme: Theme;
  toggleTheme(): void;
  viewMode: ViewMode;
  setViewMode(m: ViewMode): void;
  /** True when WebGL failed or was lost: the 3D view is unavailable this session. */
  glFailed: boolean;
  reportGlFailure(reason: 'unavailable' | 'lost'): void;
  tiltLink: boolean;
  setTiltLink(v: boolean): void;
  applyPose(p: MotionPose): void;

  wakeLock: boolean;
  setWakeLock(v: boolean): void;
  sensorsOn: boolean;
  toggleSensors(): Promise<void>;
  sensorError: TKey | null;
}

const Ctx = createContext<Host | null>(null);
export const useHost = (): Host => {
  const h = useContext(Ctx);
  if (!h) throw new Error('useHost outside HostProvider');
  return h;
};

let noticeSeq = 0;

export function HostProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const layout = useLayoutMode();
  const phone = isPhone(layout);

  const tRef = useRef(t);
  tRef.current = t;

  // long-lived services ------------------------------------------------------
  const services = useRef<{ bench: BenchStore; painter: ScreenPainter; bundles: BundleStore | null } | null>(null);
  if (!services.current) {
    let bundles: BundleStore | null = null;
    try {
      bundles = typeof indexedDB === 'undefined' ? null : new BundleStore(indexedDB);
    } catch {
      bundles = null;
    }
    services.current = { bench: new BenchStore(safeLocal()), painter: new ScreenPainter(), bundles };
  }
  const { bench, painter, bundles: bundleStore } = services.current;

  const [useMock, setUseMockState] = useState(true);
  const [device, setDevice] = useState<KodeDevice>(() => createDevice('mock'));
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const input = useMemo(() => new InputController(() => deviceRef.current), []);

  // notices -----------------------------------------------------------------
  const [notice, setNotice] = useState<Notice | null>(null);
  const say = useCallback((kind: Notice['kind'], key: TKey, vars?: Vars) => setNotice({ id: ++noticeSeq, kind, key, vars }), []);

  // device lifecycle --------------------------------------------------------
  useEffect(() => {
    painter.attach(device);
    syncBench(device, bench);
    const off = bench.subscribe(() => syncBench(device, bench));
    if (device.info.kind === 'mock') void device.start();
    return () => {
      off();
    };
  }, [device, painter, bench]);

  const setUseMock = useCallback(
    (v: boolean) => {
      input.releaseAll();
      deviceRef.current.dispose();
      const kind: DeviceKind = v ? 'mock' : 'wasm';
      setUseMockState(v);
      setDevice(createDevice(kind));
      if (!v) say('info', 'notice.wasmOn');
      else setNotice(null);
    },
    [input, say],
  );

  // apps --------------------------------------------------------------------
  const [bundles, setBundles] = useState<BundleMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(() => loadPref<string | null>('dotbench.bundle', null));
  const refresh = useCallback(async () => {
    if (!bundleStore) return;
    try {
      setBundles(await bundleStore.list());
    } catch (e) {
      say('error', 'notice.storageFail', { error: String((e as Error).message ?? e) });
    }
  }, [bundleStore, say]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runBundle = useCallback(
    async (id: string) => {
      if (!bundleStore) return say('error', 'notice.storageFail', { error: 'IndexedDB' });
      setSelectedId(id);
      savePref('dotbench.bundle', id);
      let name = id;
      try {
        const rec = await bundleStore.get(id);
        if (!rec) return;
        name = rec.meta.name;
        const dev = deviceRef.current;
        await dev.load(rec.data, { name });
        if (!dev.info.runsBundles) return say('info', 'notice.mockIgnores');
        await dev.start();
        setNotice(null);
      } catch (e) {
        if (e instanceof NotWiredError) say('error', 'notice.notWired', { name });
        else say('error', 'notice.loadFail', { name, error: String((e as Error).message ?? e) });
      }
    },
    [bundleStore, say],
  );

  const addBundleFile = useCallback(
    async (file: File) => {
      if (!/\.dotbench$/i.test(file.name)) return say('error', 'notice.badExt');
      if (!bundleStore) return say('error', 'notice.storageFail', { error: 'IndexedDB' });
      try {
        const meta = await bundleStore.add(file.name, await file.arrayBuffer());
        await refresh();
        await runBundle(meta.id);
      } catch (e) {
        say('error', 'notice.storageFail', { error: String((e as Error).message ?? e) });
      }
    },
    [bundleStore, refresh, runBundle, say],
  );

  const removeBundle = useCallback(
    async (id: string) => {
      try {
        await bundleStore?.remove(id);
        if (selectedId === id) {
          setSelectedId(null);
          savePref('dotbench.bundle', null);
        }
        await refresh();
      } catch (e) {
        say('error', 'notice.storageFail', { error: String((e as Error).message ?? e) });
      }
    },
    [bundleStore, refresh, say, selectedId],
  );

  const restart = useCallback(async () => {
    try {
      await deviceRef.current.restart();
      setNotice(null);
    } catch (e) {
      if (e instanceof NotWiredError) say('error', 'notice.notWiredShort');
      else say('error', 'notice.loadFail', { name: '', error: String((e as Error).message ?? e) });
    }
  }, [say]);
  const stop = useCallback(() => deviceRef.current.stop(), []);

  // theme / view ------------------------------------------------------------
  const [theme, setTheme] = useState<Theme>(() => (loadPref<string>('dotbench.theme', 'dark') === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = cur === 'dark' ? 'light' : 'dark';
      savePref('dotbench.theme', next);
      return next;
    });
  }, []);

  const viewKey = phone ? 'dotbench.view.phone' : 'dotbench.view';
  const [viewPrefs, setViewPrefs] = useState<Record<string, ViewMode>>(() => ({
    'dotbench.view': loadPref<ViewMode>('dotbench.view', '3d') === '2d' ? '2d' : '3d',
    'dotbench.view.phone': loadPref<ViewMode>('dotbench.view.phone', '2d') === '3d' ? '3d' : '2d',
  }));
  const setViewMode = useCallback(
    (m: ViewMode) => {
      setViewPrefs((p) => ({ ...p, [viewKey]: m }));
      savePref(viewKey, m);
    },
    [viewKey],
  );
  const [glFailed, setGlFailed] = useState(false);
  const reportGlFailure = useCallback(
    (reason: 'unavailable' | 'lost') => {
      setGlFailed(true);
      say('info', reason === 'lost' ? 'device.glLost' : 'device.glFallback');
    },
    [say],
  );
  const [tiltLink, setTiltLink] = useState(false);
  const applyPose = useCallback((p: MotionPose) => applyPoseToBench(bench, p, () => tRef.current('kind.motion.pose')), [bench]);

  // debug hook for the headless checks (?debug in the URL)
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    (window as unknown as Record<string, unknown>).__dotbench = { device: () => deviceRef.current, bench, input };
  }, [bench, input]);

  // input: keyboard, visibility ---------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const id = keyToButton(e);
      if (!id) return;
      e.preventDefault();
      input.press(id, `key:${e.key.toLowerCase()}`);
    };
    const up = (e: KeyboardEvent) => {
      const id = keyToButton(e);
      if (id) input.release(id, `key:${e.key.toLowerCase()}`);
    };
    const releaseAll = () => input.releaseAll();
    const vis = () => {
      if (document.visibilityState === 'hidden') input.releaseAll();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', releaseAll);
    window.addEventListener('pagehide', releaseAll);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pagehide', releaseAll);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [input]);

  // phone vibration ---------------------------------------------------------
  const haptic = useObservable(device.haptic);
  const hapticPrev = useRef(0);
  useEffect(() => {
    if (haptic >= 0.05 && hapticPrev.current < 0.05) vibrate(Math.round(20 + haptic * 180));
    else if (haptic === 0 && hapticPrev.current > 0) vibrate(0);
    hapticPrev.current = haptic;
  }, [haptic]);

  // wake lock ----------------------------------------------------------------
  const [wakeLock, setWakeLockState] = useState<boolean>(() => loadPref('dotbench.wake', true));
  const setWakeLock = useCallback((v: boolean) => {
    setWakeLockState(v);
    savePref('dotbench.wake', v);
  }, []);
  const status = useObservable(device.status);
  useEffect(() => {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (!wakeLock || status !== 'running' || !nav.wakeLock) return;
    let lock: { release(): Promise<void> } | null = null;
    let live = true;
    const acquire = async () => {
      try {
        const l = await nav.wakeLock!.request('screen');
        if (live) lock = l;
        else void l.release().catch(() => {});
      } catch {
        /* not allowed right now: ignore */
      }
    };
    void acquire();
    const vis = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', vis);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', vis);
      void lock?.release().catch(() => {});
    };
  }, [wakeLock, status]);

  // phone sensors -----------------------------------------------------------
  const [sensorsOn, setSensorsOn] = useState(false);
  const [sensorError, setSensorError] = useState<TKey | null>(null);
  const bridge = useRef<SensorBridge | null>(null);
  const toggleSensors = useCallback(async () => {
    if (bridge.current) {
      bridge.current.stop();
      bridge.current = null;
      setSensorsOn(false);
      return;
    }
    setSensorError(null);
    const b = new SensorBridge(
      (p) => applyPoseToBench(bench, p, () => tRef.current('kind.motion.pose')),
      () => deviceRef.current.areas.motion?.shake(),
      () => {
        setSensorError('sensors.noData');
        b.stop();
        bridge.current = null;
        setSensorsOn(false);
      },
    );
    const r = await b.start();
    if (!r.ok) return setSensorError(r.reason);
    bridge.current = b;
    setSensorsOn(true);
  }, [bench]);
  useEffect(() => () => bridge.current?.stop(), []);

  const host: Host = {
    layout,
    device,
    useMock,
    setUseMock,
    input,
    painter,
    bench,
    bundles,
    selectedId,
    addBundleFile,
    runBundle,
    removeBundle,
    restart,
    stop,
    notice,
    dismissNotice: () => setNotice(null),
    theme,
    toggleTheme,
    viewMode: glFailed ? '2d' : viewPrefs[viewKey],
    setViewMode,
    glFailed,
    reportGlFailure,
    tiltLink,
    setTiltLink,
    applyPose,
    wakeLock,
    setWakeLock,
    sensorsOn,
    toggleSensors,
    sensorError,
  };
  return <Ctx.Provider value={host}>{children}</Ctx.Provider>;
}
