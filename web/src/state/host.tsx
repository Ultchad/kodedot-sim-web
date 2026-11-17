import { setUsbSystem } from '../bench/drivers/usb';
import { APP_PACKAGE_RE } from '../lib/appPackage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyPoseToBench } from '../bench/sync';
import { DRIVERS } from '../bench/drivers';
import { LiveStore } from '../bench/live';
import { BenchRuntime } from '../bench/runtime';
import { BenchStore } from '../bench/store';
import { createDevice, type DeviceKind } from '../device';
import type { KodeDevice } from '../device/types';
import { Atom } from '../device/observable';
import { isRealDevice, type InstalledApp, type Program, type RealDevice } from '../device/wasm';
import { useI18n, type TKey } from '../i18n';
import type { Vars } from '../i18n/core';
import { displayAppName } from '../lib/dotapps';
import { InputController } from '../lib/input';
import { isEditableTarget, keyToButton, ownsArrowKeys } from '../lib/keys';
import { isPhone, useLayoutMode, type LayoutMode } from '../lib/layout';
import { customModel } from '../device3d/customModel';
import { ModelController, classifyFile, isModelStore, type CustomModelState, type CustomModelStore } from '../lib/modelChoice';
import type { MotionPose } from '../device/motion';
import { loadPref, safeLocal, savePref } from '../lib/prefs';
import { ScreenPainter } from '../lib/screen';
import { SensorBridge, vibrate } from '../lib/sensors';
import { useObservable } from './hooks';
import { Selection, WorkbenchBus } from '../workbench/state';
import { PartsService } from '../parts/service';

export type ViewMode = '3d' | '2d';
/** 'device': the Dot alone (3D or 2D). 'workbench': the Dot on the table among the bench objects (3D only). */
export type StageMode = 'device' | 'workbench';
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
  /** What the Dot did with each bench object. */
  live: LiveStore;
  /** Keeps the Dot's world equal to the bench (re-applies it to every program that starts). */
  runtime: BenchRuntime;

  /** What runs on the Dot: kodeOS (kind 'os') or one of its apps; null while it is off (and on the test device). */
  program: Program | null;
  /** The apps installed in kodeOS. */
  apps: readonly InstalledApp[];
  /** Install a .dotbench into kodeOS, then open it. */
  installFile(file: File): Promise<void>;
  /** Open an installed app (the same as tapping it in kodeOS's list). */
  launchApp(id: string): Promise<void>;
  removeApp(id: string): Promise<void>;
  /** Back to kodeOS from the running app (the same as holding the bottom button for 3 s). */
  goHome(): Promise<void>;
  /** Erase the Dot: settings, files and apps go, the factory apps come back. */
  factoryReset(): Promise<void>;
  /** What the app manager is busy with, for its own progress line. */
  appBusy: 'install' | 'remove' | 'reset' | null;
  exportDevice(): Promise<void>;
  importDeviceFile(file: File): Promise<void>;
  restart(): Promise<void>;
  stop(): void;

  notice: Notice | null;
  dismissNotice(): void;
  /** True from page load until the Dot was powered on for the first time: "nothing runs yet" is then loading, not a stopped Dot. */
  launching: boolean;
  /** Bumped when some part of the page asks for the app list (idle card, welcome hint); the picker or the phone sheet opens it. */
  appsRequest: number;
  requestApps(): void;
  /** "Use my own 3D model": the controller over the 3D code's store (absent while that code has not landed). */
  model: ModelController;
  /** A dropped .glb waiting for the visitor's yes or no. */
  modelOffer: File | null;
  /** Any dropped or picked file: apps run, models are offered, the rest is declined politely. */
  openFile(file: File): void;
  applyModelFile(file: File): Promise<void>;
  resolveModelOffer(accept: boolean): void;
  /** First-visit hint, until the visitor dismisses it. */
  welcome: boolean;
  dismissWelcome(): void;

  theme: Theme;
  toggleTheme(): void;
  setTheme(t: Theme): void;
  viewMode: ViewMode;
  setViewMode(m: ViewMode): void;
  /** True when WebGL failed or was lost: the 3D view is unavailable this session. */
  glFailed: boolean;
  reportGlFailure(reason: 'unavailable' | 'lost'): void;
  /** Which stage is on show. The Workbench needs WebGL: without it this reads 'device'. */
  mode: StageMode;
  setMode(m: StageMode): void;
  /** What is selected on the bench (the Workbench scene and the side panel share it). */
  select: Selection;
  /** Commands from the page to the Workbench scene. */
  bus: WorkbenchBus;
  /** The wired parts: the library and the parts engine. */
  parts: PartsService;
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
const NO_PROGRAM = new Atom<Program | null>(null);
const NO_APPS = new Atom<readonly InstalledApp[]>([]);

/** Display name of an app: a saved bundle's file name without the extension; the system reads kodeOS. */
export const appLabel = (name: string): string => displayAppName(name.replace(APP_PACKAGE_RE, ''));

export function HostProvider({ children }: { children: ReactNode }) {
  const { t, setLocale } = useI18n();
  const layout = useLayoutMode();
  const phone = isPhone(layout);

  const tRef = useRef(t);
  tRef.current = t;

  // long-lived services ------------------------------------------------------
  const services = useRef<{ bench: BenchStore; live: LiveStore; runtime: BenchRuntime; painter: ScreenPainter; model: ModelController; select: Selection; bus: WorkbenchBus; parts: PartsService } | null>(null);
  if (!services.current) {
    const b = new BenchStore(safeLocal());
    const l = new LiveStore();
    services.current = { bench: b, live: l, runtime: new BenchRuntime(b, l, DRIVERS), painter: new ScreenPainter(), model: new ModelController(), select: new Selection(), bus: new WorkbenchBus(), parts: new PartsService(b) };
  }
  const { bench, live, runtime, painter, model, select, bus, parts } = services.current;
  // the 3D code's own store; the controller tolerates anything that does not follow the contract
  useEffect(() => {
    if (!model.available && isModelStore(customModel)) model.setStore(customModel);
  }, [model]);

  const [useMock, setUseMockState] = useState(() => loadPref<boolean>('dotbench.mock', false) === true);
  const [device, setDevice] = useState<KodeDevice>(() => createDevice(loadPref<boolean>('dotbench.mock', false) === true ? 'mock' : 'wasm'));
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const input = useMemo(() => new InputController(() => deviceRef.current), []);

  // notices -----------------------------------------------------------------
  const [notice, setNotice] = useState<Notice | null>(null);
  const say = useCallback((kind: Notice['kind'], key: TKey, vars?: Vars) => setNotice({ id: ++noticeSeq, kind, key, vars }), []);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const [appsRequest, setAppsRequest] = useState(0);
  const requestApps = useCallback(() => setAppsRequest((n) => n + 1), []);
  const [welcome, setWelcome] = useState(() => loadPref<boolean>('dotbench.welcomed', false) !== true);
  const dismissWelcome = useCallback(() => {
    setWelcome(false);
    savePref('dotbench.welcomed', true);
  }, []);

  // device lifecycle --------------------------------------------------------
  useEffect(() => {
    painter.attach(device);
    parts.setDevice(device);
    setUsbSystem(() => (device as unknown as { system?: () => Promise<unknown> }).system?.() ?? Promise.resolve(null));
    const off = runtime.attach(device);
    if (device.info.kind === 'mock') void device.start();
    return () => {
      off();
    };
  }, [device, painter, runtime]);

  const setUseMock = useCallback(
    (v: boolean) => {
      input.releaseAll();
      deviceRef.current.dispose();
      const kind: DeviceKind = v ? 'mock' : 'wasm';
      setUseMockState(v);
      savePref('dotbench.mock', v);
      setDevice(createDevice(kind));
      setLaunching(!v);
      setNotice(null);
    },
    [input],
  );

  // the Dot and its apps -----------------------------------------------------
  // The Dot always boots kodeOS. Apps live inside it: the system layer installs, lists, opens and removes them, and
  // plays the bootloader between programs, so the page only ever asks and is told what runs.
  const real = isRealDevice(device) ? device : null;
  const program = useObservable(real ? real.program : NO_PROGRAM);
  const apps = useObservable(real ? real.apps : NO_APPS);
  const [launching, setLaunching] = useState(() => loadPref<boolean>('dotbench.mock', false) !== true);
  const [appBusy, setAppBusy] = useState<Host['appBusy']>(null);
  const errorText = (e: unknown) => String((e as Error)?.message ?? e);

  // power on: at page load, and every time the real device is switched on
  const poweredFor = useRef<KodeDevice | null>(null);
  useEffect(() => {
    if (!isRealDevice(device) || poweredFor.current === device) return;
    poweredFor.current = device;
    if (device.unsupported.length) return setLaunching(false); // the stage card explains it
    device
      .start()
      .catch(() => {
        /* shown on the stage as "stopped" with the reason */
      })
      .finally(() => setLaunching(false));
  }, [device]);

  /** The real Dot, or null after telling why not (test device, unsupported browser). */
  const dot = useCallback((): RealDevice | null => {
    const dev = deviceRef.current;
    if (!isRealDevice(dev)) {
      say('info', 'notice.mockIgnores');
      return null;
    }
    return dev.unsupported.length ? null : dev;
  }, [say]);

  const launchApp = useCallback(
    async (id: string) => {
      const dev = dot();
      if (!dev) return;
      const name = dev.apps.get().find((a) => a.id === id)?.name ?? '';
      try {
        await dev.launch(id);
        setNotice(null);
      } catch (e) {
        if (dev.status.get() !== 'crashed') say('error', 'notice.loadFail', { name: appLabel(name), error: errorText(e) });
      }
    },
    [dot, say],
  );

  const installFile = useCallback(
    async (file: File) => {
      if (!APP_PACKAGE_RE.test(file.name)) return say('error', 'notice.badExt');
      const dev = dot();
      if (!dev) return;
      setAppBusy('install');
      try {
        const id = await dev.install(await file.arrayBuffer());
        const name = dev.apps.get().find((a) => a.id === id)?.name ?? file.name;
        await dev.launch(id);
        // confirm where the file went: it runs now and stays in kodeOS's list
        say('info', 'notice.appAdded', { name: appLabel(name) });
        dismissWelcome();
      } catch (e) {
        say('error', 'notice.installFail', { name: file.name, error: errorText(e) });
      } finally {
        setAppBusy(null);
      }
    },
    [dot, say, dismissWelcome],
  );

  const removeApp = useCallback(
    async (id: string) => {
      const dev = dot();
      if (!dev) return;
      const name = dev.apps.get().find((a) => a.id === id)?.name ?? '';
      setAppBusy('remove');
      try {
        await dev.removeApp(id);
        say('info', 'notice.appRemoved', { name: appLabel(name) });
      } catch (e) {
        say('error', 'notice.removeFail', { name: appLabel(name), error: errorText(e) });
      } finally {
        setAppBusy(null);
      }
    },
    [dot, say],
  );

  const goHome = useCallback(async () => {
    const dev = dot();
    try {
      await dev?.home();
    } catch {
      /* the stage shows what happened */
    }
  }, [dot]);

  const factoryReset = useCallback(async () => {
    const dev = dot();
    if (!dev) return;
    input.releaseAll();
    setAppBusy('reset');
    try {
      await dev.factoryReset();
      say('info', 'notice.factoryReset');
    } catch (e) {
      say('error', 'notice.deviceFail', { error: errorText(e) });
    } finally {
      setAppBusy(null);
    }
  }, [dot, say, input]);

  const restart = useCallback(async () => {
    try {
      await deviceRef.current.restart();
      setNotice(null);
    } catch {
      /* the stage shows why the Dot could not start */
    }
  }, []);
  const stop = useCallback(() => deviceRef.current.stop(), []);

  const exportDevice = useCallback(async () => {
    const dev = deviceRef.current;
    if (!isRealDevice(dev)) return say('info', 'notice.deviceMockOnly');
    try {
      const { data, extension } = await dev.exportDevice();
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `dotbench-device-${new Date().toISOString().slice(0, 10)}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      say('info', 'notice.deviceExported');
    } catch (e) {
      say('error', 'notice.deviceFail', { error: String((e as Error).message ?? e) });
    }
  }, [say]);
  const importDeviceFile = useCallback(
    async (file: File) => {
      const dev = deviceRef.current;
      if (!isRealDevice(dev)) return say('info', 'notice.deviceMockOnly');
      try {
        await dev.importDevice(new Uint8Array(await file.arrayBuffer()));
        say('info', 'notice.deviceImported');
      } catch (e) {
        say('error', 'notice.deviceFail', { error: String((e as Error).message ?? e) });
      }
    },
    [say],
  );

  // theme / view ------------------------------------------------------------
  const [theme, setTheme] = useState<Theme>(() => (loadPref<string>('dotbench.theme', 'light') === 'dark' ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark';
      savePref('dotbench.theme', next);
      return next;
    });
  }, []);

  const chooseTheme = useCallback((next: Theme) => {
    setTheme(next);
    savePref('dotbench.theme', next);
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
  // Device or Workbench: remembered apart for the desk and for the phone, where the device alone stays the way in.
  // `?mode=device|workbench` in the URL decides for one visit without being remembered (the check scripts use it).
  const modeKey = phone ? 'dotbench.mode.phone' : 'dotbench.mode';
  const [modePrefs, setModePrefs] = useState<Record<string, StageMode>>(() => {
    const forced = new URLSearchParams(location.search).get('mode');
    const pick = (k: string, d: StageMode): StageMode => (forced === 'device' || forced === 'workbench' ? forced : loadPref<StageMode>(k, d) === 'workbench' ? 'workbench' : loadPref<StageMode>(k, d) === 'device' ? 'device' : d);
    return { 'dotbench.mode': pick('dotbench.mode', 'workbench'), 'dotbench.mode.phone': pick('dotbench.mode.phone', 'device') };
  });
  const setMode = useCallback(
    (m: StageMode) => {
      setModePrefs((p) => ({ ...p, [modeKey]: m }));
      savePref(modeKey, m);
    },
    [modeKey],
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

  // own 3D model -----------------------------------------------------------
  const [modelOffer, setModelOffer] = useState<File | null>(null);
  const applyModelFile = useCallback(
    async (file: File) => {
      const r = await model.use(file, file.name);
      if (r.ok) {
        if (!glFailed) setViewMode('3d'); // show what was just loaded
        return say('info', 'notice.modelUsed', { name: file.name });
      }
      if (r.reason === 'unavailable') return say('info', 'notice.modelUnavailable');
      if (r.reason === 'not-glb') return say('error', 'notice.notGlb');
      say('error', 'notice.modelFail', { name: file.name, error: r.message || '?' });
    },
    [model, glFailed, setViewMode, say],
  );
  const openFile = useCallback(
    (file: File) => {
      const kind = classifyFile(file.name);
      if (kind === 'app') return void installFile(file);
      if (kind === 'other') return say('error', 'notice.dropOther', { name: file.name });
      if (!model.available) return say('info', 'notice.modelUnavailable');
      setModelOffer(file); // a model replaces what the 3D view shows: ask first
    },
    [installFile, model, say],
  );
  const resolveModelOffer = useCallback(
    (accept: boolean) => {
      setModelOffer((file) => {
        if (accept && file) void applyModelFile(file);
        return null;
      });
    },
    [applyModelFile],
  );

  // debug hook for the headless checks (?debug in the URL)
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('debug')) return;
    (window as unknown as Record<string, unknown>).__dotbench = {
      device: () => deviceRef.current,
      bench,
      live,
      select,
      bus,
      parts,
      runtime,
      input,
      painter,
      model,
      applyPose,
      // lets the layout audit walk every theme and language on one page load
      ui: {
        // stands in for the 3D code's store, so every state of the "3D model" entry can be shown and audited
        fakeModel: (state: CustomModelState | null) => {
          if (!state) return model.setStore(null);
          const listeners = new Set<() => void>();
          let cur = state;
          const store: CustomModelStore = {
            getState: () => cur,
            subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
            load: async (_f, name) => {
              cur = { ...cur, status: 'ready', name, sizeBytes: _f.size, warnings: [], error: undefined };
              for (const l of listeners) l();
            },
            remove: async () => {
              cur = { status: 'none', builtin: cur.builtin, bundled: cur.bundled, performance: cur.performance, options: cur.options, selected: cur.options?.[0]?.id };
              for (const l of listeners) l();
            },
            setBuiltin: (choice) => {
              cur = { ...cur, builtin: choice };
              for (const l of listeners) l();
            },
            setOptions: async (o) => {
              cur = { ...cur, performance: o.performance ?? cur.performance };
              for (const l of listeners) l();
            },
            ...(state.options ? { select: async (id: string) => ((cur = { ...cur, selected: id }), listeners.forEach((l) => l())) } : {}),
          };
          model.setStore(store);
        },
        offerModel: (name: string) => setModelOffer(new File([new Uint8Array(1024)], name)),
        setTheme: (v: Theme) => setTheme(v),
        setMode: (m: StageMode) => setMode(m),
        setLocale,
        notify: (kind: Notice['kind'], key: TKey, vars?: Vars) => say(kind, key, vars),
      },
    };
  }, [bench, live, runtime, input, painter, setLocale, say, model, select, bus, setMode]);

  // input: keyboard, visibility ---------------------------------------------
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const id = keyToButton(e);
      if (!id) return;
      if (e.key.startsWith('Arrow') && ownsArrowKeys(e.target)) return; // tabs, menus, sliders and scroll regions keep their arrows
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
      () => deviceRef.current.areas.motion?.shake?.(),
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
    live,
    runtime,
    program,
    apps,
    installFile,
    launchApp,
    removeApp,
    goHome,
    factoryReset,
    appBusy,
    exportDevice,
    importDeviceFile,
    restart,
    stop,
    notice,
    dismissNotice,
    launching: launching && device.info.kind === 'wasm',
    appsRequest,
    requestApps,
    model,
    modelOffer,
    openFile,
    applyModelFile,
    resolveModelOffer,
    welcome,
    dismissWelcome,
    theme,
    toggleTheme,
    setTheme: chooseTheme,
    viewMode: glFailed ? '2d' : viewPrefs[viewKey],
    setViewMode,
    glFailed,
    reportGlFailure,
    mode: glFailed ? 'device' : modePrefs[modeKey],
    setMode,
    select,
    bus,
    parts,
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
