import { describe, expect, it } from 'vitest';
import type { AdapterLogLine, AdapterOutputs, AdapterStatus, AdapterStatusDetail, AdapterSystem, InstalledApp, Program } from './adapter-types';
import { checkRuntime, isRealDevice, parseFactory, SystemDevice, UnsupportedRuntimeError } from './wasm';

const KART: InstalledApp = { id: 'aa', project: 'kody_kart', name: 'Kody Kart', version: '1.0.0', category: 'Games', size: 4096, hasBundle: true };

/** Stands in for DotbenchSystem: one object, kodeOS or an app running, restarts never shown. */
class FakeSystem {
  listeners = new Map<string, Set<(d: never) => void>>();
  status: AdapterStatus = 'idle';
  program: Program | null = null;
  workerCount = 3;
  wasmMemoryBytes = 100 * 1024 * 1024;
  seq = 5;
  frameValue = 7;
  copies = 0;
  calls: string[] = [];
  installed: (InstalledApp & { offset?: number })[] = [{ ...KART, offset: 8192 }];
  glue: Record<string, unknown> = {};
  out: AdapterOutputs = { led: { r: 0, g: 255, b: 0 }, haptic: 0, backlight: 100, panelOn: true };
  failStart: Error | null = null;
  device = {
    importDeviceFile: async (b: Uint8Array) => {
      this.calls.push(`importDeviceFile ${b.length}`);
    },
  };
  on(type: string, cb: (d: never) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(cb);
    return () => this.listeners.get(type)!.delete(cb);
  }
  emit(type: string, d: unknown) {
    for (const cb of this.listeners.get(type) ?? []) cb(d as never);
  }
  setStatus(s: AdapterStatusDetail) {
    this.status = s.status;
    this.emit('status', s);
  }
  private boot(p: Program) {
    this.setStatus({ status: 'booting' });
    this.program = p;
    this.emit('program', p);
    this.setStatus({ status: 'running' });
  }
  async start() {
    this.calls.push('start');
    if (this.failStart) throw this.failStart;
    this.boot({ id: 'os', name: 'kodeOS', kind: 'os' });
  }
  stop() {
    this.calls.push('stop');
    this.program = null;
    this.setStatus({ status: 'idle' });
  }
  dispose() {
    this.calls.push('dispose');
  }
  async powerOnReset() {
    this.calls.push('powerOnReset');
    this.boot({ id: 'os', name: 'kodeOS', kind: 'os' });
  }
  async home() {
    this.calls.push('home');
    this.boot({ id: 'os', name: 'kodeOS', kind: 'os' });
  }
  async launch(id: string) {
    this.calls.push(`launch ${id}`);
    const app = this.installed.find((a) => a.id === id);
    if (!app) throw new Error('no such app: ' + id);
    this.boot({ id, name: app.name, kind: 'app' });
  }
  async install(bytes: Uint8Array) {
    this.calls.push(`install ${bytes.length}`);
    this.installed.push({ id: 'bb', project: 'blink', name: 'Blink', version: '0.1.0', category: '', size: 4096, hasBundle: true });
    this.emit('apps', this.list());
    return { id: 'bb', project: 'blink' };
  }
  list() {
    return this.installed;
  }
  async remove(id: string) {
    this.calls.push(`remove ${id}`);
    this.installed = this.installed.filter((a) => a.id !== id);
    this.emit('apps', this.list());
    return true;
  }
  async factoryReset() {
    this.calls.push('factoryReset');
    this.installed = [{ ...KART }];
    this.emit('apps', this.list());
  }
  copyFrame(out: Uint8ClampedArray, last = -1) {
    if (last === this.seq) return last;
    this.copies++;
    out.fill(this.frameValue);
    return this.seq;
  }
  button(id: number | string, p: boolean) {
    this.calls.push(`button ${id} ${p}`);
  }
  touch(x: number, y: number, d: boolean) {
    this.calls.push(`touch ${x},${y} ${d}`);
  }
  releaseAll() {
    this.calls.push('releaseAll');
  }
  outputs() {
    return this.out;
  }
  sendConsole(line: string) {
    this.calls.push(`console ${line}`);
    this.emit('log', { id: 1, ts: 1, level: 'input', text: line, channel: 1 } satisfies AdapterLogLine);
  }
  time() {
    return 12345;
  }
  area(name: string) {
    return this.glue[name] ?? null;
  }
  exportDeviceFile() {
    return new Uint8Array([1, 2, 3]);
  }
  async flushPersist() {}
}

const okEnv = { crossOriginIsolated: true, SharedArrayBuffer: class {}, WebAssembly: { Memory: class {} }, DecompressionStream: class {} };
function make(sys = new FakeSystem(), env: object = okEnv) {
  const dev = new SystemDevice({ createSystem: async () => sys as unknown as AdapterSystem, env: env as never });
  return { dev, sys };
}
const started = async () => {
  const m = make();
  await m.dev.start();
  return m;
};

describe('checkRuntime', () => {
  it('accepts a capable browser', () => expect(checkRuntime(okEnv as never)).toEqual([]));
  it('names every missing piece', () => {
    expect(checkRuntime({ ...okEnv, crossOriginIsolated: false } as never)).toEqual(['not-isolated']);
    expect(checkRuntime({ ...okEnv, SharedArrayBuffer: undefined, crossOriginIsolated: false } as never)).toEqual(['not-isolated', 'no-shared-array-buffer']);
    expect(checkRuntime({ ...okEnv, WebAssembly: { Memory: class { constructor() { throw new Error('no'); } } } } as never)).toEqual(['no-wasm-threads']);
    expect(checkRuntime({ ...okEnv, DecompressionStream: undefined } as never)).toEqual(['no-decompression-stream']);
    expect(checkRuntime({} as never)).toEqual(['no-webassembly']);
  });
});

describe('parseFactory', () => {
  it('reads the package list of factory.json', () => {
    expect(parseFactory({ format: 1, apps: ['kody_kart.dotbench', 'display_lvgl.dotbench'] })).toEqual(['kody_kart.dotbench', 'display_lvgl.dotbench']);
  });
  it('takes anything else as no factory apps, and drops entries that are not package names', () => {
    expect(parseFactory(null)).toEqual([]);
    expect(parseFactory({ format: 2, apps: ['a.dotbench'] })).toEqual([]);
    expect(parseFactory({ format: 1 })).toEqual([]);
    expect(parseFactory({ format: 1, apps: ['a.dotbench', '../b.dotbench', 7, 'c.zip'] })).toEqual(['a.dotbench']);
  });
});

describe('SystemDevice', () => {
  it('refuses to start in an unsupported browser with the problem list', async () => {
    const { dev } = make(new FakeSystem(), { ...okEnv, crossOriginIsolated: false });
    expect(dev.unsupported).toEqual(['not-isolated']);
    await expect(dev.start()).rejects.toBeInstanceOf(UnsupportedRuntimeError);
  });

  it('powers on into kodeOS, names what runs and lists the installed apps', async () => {
    const { dev } = await started();
    expect(dev.status.get()).toBe('running');
    expect(dev.program.get()).toEqual({ id: 'os', name: 'kodeOS', kind: 'os' });
    expect(dev.appName.get()).toBe('kodeOS');
    expect(dev.apps.get()).toEqual([KART]); // the page's own shape: no region offsets
    dev.stop();
    expect(dev.status.get()).toBe('idle');
    expect(dev.program.get()).toBeNull();
    expect(dev.appName.get()).toBeNull();
  });

  it('opens an app and goes home without the page seeing a restart', async () => {
    const { dev, sys } = await started();
    const seen: string[] = [];
    dev.status.subscribe(() => seen.push(dev.status.get()));
    await dev.launch('aa');
    expect(dev.program.get()).toEqual({ id: 'aa', name: 'Kody Kart', kind: 'app' });
    expect(dev.appName.get()).toBe('Kody Kart');
    sys.setStatus({ status: 'restart-requested', reason: 'software' }); // never forwarded by the real system; ignored if it were
    await dev.home();
    expect(dev.program.get()?.kind).toBe('os');
    expect(new Set(seen)).toEqual(new Set(['booting', 'running']));
  });

  it('installs a package, lists it, removes it, and resets to the factory apps', async () => {
    const { dev, sys } = await started();
    expect(await dev.install(new ArrayBuffer(10))).toBe('bb');
    expect(dev.apps.get().map((a) => a.name)).toEqual(['Kody Kart', 'Blink']);
    await dev.removeApp('aa');
    expect(dev.apps.get().map((a) => a.name)).toEqual(['Blink']);
    await dev.factoryReset();
    expect(dev.apps.get().map((a) => a.name)).toEqual(['Kody Kart']);
    expect(sys.calls).toEqual(expect.arrayContaining(['install 10', 'remove aa', 'factoryReset']));
  });

  it('keeps the same list object while nothing changed', async () => {
    const { dev, sys } = await started();
    const list = dev.apps.get();
    sys.emit('apps', sys.list());
    expect(dev.apps.get()).toBe(list);
  });

  it('restart is a reset of the Dot: kodeOS comes up; a stopped Dot is powered on', async () => {
    const { dev, sys } = await started();
    await dev.launch('aa');
    await dev.restart();
    expect(sys.calls.at(-1)).toBe('powerOnReset');
    expect(dev.program.get()?.kind).toBe('os');
    dev.stop();
    await dev.restart();
    expect(sys.calls.at(-1)).toBe('start');
    expect(dev.status.get()).toBe('running');
  });

  it('shows an app crash as the Dot restarting, an OS crash and a failed start as crashed with the reason', async () => {
    const { dev, sys } = await started();
    sys.setStatus({ status: 'booting', reason: 'app crashed: abort' });
    expect(dev.detail.get()).toEqual({ status: 'booting', reason: 'app crashed: abort', restarting: true });
    sys.setStatus({ status: 'crashed', reason: 'panic' });
    expect(dev.detail.get()).toEqual({ status: 'crashed', reason: 'panic' });
    expect(dev.led.get()).toEqual({ r: 0, g: 0, b: 0 });

    const bad = new FakeSystem();
    bad.failStart = new Error('HTTP 404 for kodeos.dotbench');
    const m = make(bad);
    await expect(m.dev.start()).rejects.toThrow(/404/);
    expect(m.dev.detail.get()).toEqual({ status: 'crashed', reason: 'HTTP 404 for kodeos.dotbench' });
  });

  it('reuses the frame while the picture is unchanged and gives a monotonic seq across programs', async () => {
    const { dev, sys } = await started();
    const f1 = dev.getFrame();
    expect(f1.data[0]).toBe(7);
    expect(f1.data.buffer).toBeInstanceOf(ArrayBuffer);
    expect(dev.getFrame()).toBe(f1);
    expect(sys.copies).toBe(1);
    sys.seq = 6;
    sys.frameValue = 9;
    const f3 = dev.getFrame();
    expect(f3.seq).toBeGreaterThan(f1.seq);
    expect(f3.data[0]).toBe(9);
    // another program starts counting again: still a new seq for the page
    sys.seq = 1;
    expect(dev.getFrame().seq).toBeGreaterThan(f3.seq);
    dev.stop();
    expect(dev.getFrame().data[3]).toBe(255); // black when off
  });

  it('maps outputs, only changing the LED object when the colour changes', async () => {
    const { dev, sys } = await started();
    expect(dev.led.get()).toEqual({ r: 0, g: 255, b: 0 });
    const led = dev.led.get();
    sys.emit('outputs', { ...sys.out, haptic: 0.5, backlight: 40, panelOn: false });
    expect(dev.led.get()).toBe(led);
    expect(dev.haptic.get()).toBe(0.5);
    expect(dev.backlight.get()).toBe(40);
    expect(dev.panelOn.get()).toBe(false);
    sys.emit('outputs', { ...sys.out, led: { r: 255, g: 0, b: 0 } });
    expect(dev.led.get()).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('forwards inputs, console (echoed once as input) and time', async () => {
    const { dev, sys } = await started();
    dev.setButton('top', true);
    dev.setTouch(10, 20, true);
    dev.sendConsole('help');
    dev.releaseAll();
    expect(sys.calls).toEqual(expect.arrayContaining(['button top true', 'touch 10,20 true', 'console help', 'releaseAll']));
    expect(dev.log.get().filter((l) => l.level === 'input').map((l) => l.text)).toEqual(['help']);
    expect(dev.time()).toBe(12345);
    expect(dev.stats()).toEqual({ workers: 3, memoryBytes: 100 * 1024 * 1024 });
  });

  it('exposes area glue of the running program through areas', async () => {
    const { dev, sys } = await started();
    expect(dev.areas.motion).toBeUndefined();
    sys.glue.motion = { shake: () => 1 };
    expect(dev.areas.motion).toBe(sys.glue.motion);
  });

  it('exports the whole Dot as one file; an import stops it, replaces it and powers it on', async () => {
    const { dev, sys } = await started();
    const { data, extension } = await dev.exportDevice();
    expect(extension).toBe('dotbench-device');
    expect([...data]).toEqual([1, 2, 3]);
    sys.calls.length = 0;
    await dev.importDevice(data);
    expect(sys.calls).toEqual(['stop', 'importDeviceFile 3', 'start']);
    expect(dev.status.get()).toBe('running');
  });

  it('is a RealDevice and disposes the system', async () => {
    const { dev, sys } = await started();
    expect(isRealDevice(dev)).toBe(true);
    dev.dispose();
    expect(sys.calls).toContain('dispose');
    await expect(dev.start()).rejects.toThrow(/disposed/);
  });
});
