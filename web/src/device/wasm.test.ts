import { describe, expect, it } from 'vitest';
import type { AdapterDevice, AdapterLogLine, AdapterOutputs, AdapterStatus, AdapterStatusDetail } from './adapter-types';
import { checkRuntime, isRealDevice, UnsupportedRuntimeError, WasmDevice } from './wasm';

class FakeAdapter implements AdapterDevice {
  listeners = new Map<string, Set<(d: never) => void>>();
  status: AdapterStatus = 'idle';
  statusDetail: AdapterStatusDetail = { status: 'idle' };
  appName: string | null = null;
  workerCount = 3;
  wasmMemoryBytes = 100 * 1024 * 1024;
  seq = 5;
  frameValue = 7;
  copies = 0;
  frameSeq = 0;
  calls: string[] = [];
  lines: AdapterLogLine[] = [];
  persist = new Map<string, Uint8Array>([['nvs', new Uint8Array([4, 5])]]);
  glue: Record<string, unknown> = {};
  exportDevice?: AdapterDevice['exportDevice'];
  importDevice?: AdapterDevice['importDevice'];
  areaNames: string[] = [];
  out: AdapterOutputs = { led: { r: 0, g: 255, b: 0 }, haptic: 0, backlight: 100, panelOn: true };
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
    this.statusDetail = s;
    this.emit('status', s);
  }
  async load() {
    this.calls.push('load');
    this.appName = 'Fake App';
    this.setStatus({ status: 'idle' });
  }
  async start() {
    this.calls.push('start');
    this.setStatus({ status: 'booting' });
    this.setStatus({ status: 'running' });
  }
  stop() {
    this.calls.push('stop');
    this.setStatus({ status: 'idle' });
  }
  async restart() {
    this.calls.push('restart');
    this.setStatus({ status: 'running' });
  }
  dispose() {
    this.calls.push('dispose');
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
    this.emit('log', { id: 1, ts: 1, level: 'input', text: line, channel: 1 });
  }
  time() {
    return 12345;
  }
  area(name: string) {
    return this.glue[name] ?? null;
  }
  exportPersist() {
    return this.persist;
  }
  importPersist(m: Map<string, Uint8Array>) {
    this.calls.push('importPersist ' + [...m.keys()].join(','));
    this.persist = m;
  }
}

const okEnv = { crossOriginIsolated: true, SharedArrayBuffer: class {}, WebAssembly: { Memory: class {} }, DecompressionStream: class {} };

function make(adapter = new FakeAdapter(), env: object = okEnv) {
  const dev = new WasmDevice({ createAdapter: async () => adapter, env: env as never });
  return { dev, adapter };
}
const loaded = async () => {
  const m = make();
  await m.dev.load(new ArrayBuffer(4), { name: 'x' });
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

describe('WasmDevice', () => {
  it('refuses to load in an unsupported browser with the problem list', async () => {
    const { dev } = make(new FakeAdapter(), { ...okEnv, crossOriginIsolated: false });
    expect(dev.unsupported).toEqual(['not-isolated']);
    await expect(dev.load(new ArrayBuffer(1), { name: 'x' })).rejects.toBeInstanceOf(UnsupportedRuntimeError);
  });

  it('follows the adapter lifecycle and names the app', async () => {
    const { dev } = await loaded();
    expect(dev.appName.get()).toBe('Fake App');
    await dev.start();
    expect(dev.status.get()).toBe('running');
    dev.stop();
    expect(dev.status.get()).toBe('idle');
  });

  it('surfaces restart-requested as booting with a log line, and a crash with its reason', async () => {
    const { dev, adapter } = await loaded();
    await dev.start();
    adapter.setStatus({ status: 'restart-requested', reason: 'software', target: '' });
    expect(dev.status.get()).toBe('booting');
    expect(dev.detail.get()).toMatchObject({ status: 'booting', reason: 'software', restarting: true });
    expect(dev.log.get().at(-1)?.text).toBe('restart requested: software');
    adapter.setStatus({ status: 'restart-requested', reason: 'software', target: 'other' });
    expect(dev.log.get().at(-1)?.text).toBe('restart requested: software -> other');
    adapter.setStatus({ status: 'crashed', reason: 'panic' });
    expect(dev.status.get()).toBe('crashed');
    expect(dev.detail.get()).toEqual({ status: 'crashed', reason: 'panic' });
    expect(dev.led.get()).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('reuses the frame while the adapter frame is unchanged and gives a monotonic seq', async () => {
    const { dev, adapter } = await loaded();
    await dev.start();
    const f1 = dev.getFrame();
    expect(f1.data[0]).toBe(7);
    expect(f1.data.buffer).toBeInstanceOf(ArrayBuffer);
    const f2 = dev.getFrame();
    expect(f2).toBe(f1);
    expect(adapter.copies).toBe(1);
    adapter.seq = 6;
    adapter.frameValue = 9;
    const f3 = dev.getFrame();
    expect(f3.seq).toBeGreaterThan(f1.seq);
    expect(f3.data[0]).toBe(9);
    // restart: adapter seq may go back to a small number: still a new seq for the page
    adapter.seq = 1;
    expect(dev.getFrame().seq).toBeGreaterThan(f3.seq);
    dev.stop();
    expect(dev.getFrame().data[3]).toBe(255); // black when idle
  });

  it('maps outputs, only changing the LED object when the colour changes', async () => {
    const { dev, adapter } = await loaded();
    await dev.start();
    expect(dev.led.get()).toEqual({ r: 0, g: 255, b: 0 });
    const led = dev.led.get();
    adapter.emit('outputs', { ...adapter.out, haptic: 0.5, backlight: 40, panelOn: false });
    expect(dev.led.get()).toBe(led);
    expect(dev.haptic.get()).toBe(0.5);
    expect(dev.backlight.get()).toBe(40);
    expect(dev.panelOn.get()).toBe(false);
    adapter.emit('outputs', { ...adapter.out, led: { r: 255, g: 0, b: 0 } });
    expect(dev.led.get()).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('forwards inputs, console (echoed once as input) and time', async () => {
    const { dev, adapter } = await loaded();
    dev.setButton('top', true);
    dev.setTouch(10, 20, true);
    dev.sendConsole('help');
    dev.releaseAll();
    expect(adapter.calls).toEqual(expect.arrayContaining(['button top true', 'touch 10,20 true', 'console help', 'releaseAll']));
    expect(dev.log.get().filter((l) => l.level === 'input').map((l) => l.text)).toEqual(['help']);
    expect(dev.time()).toBe(12345);
    expect(dev.stats()).toEqual({ workers: 3, memoryBytes: 100 * 1024 * 1024 });
  });

  it('exposes area glue through areas', async () => {
    const { dev, adapter } = await loaded();
    expect(dev.areas.motion).toBeUndefined();
    adapter.glue.motion = { shake: () => 1 };
    expect(dev.areas.motion).toBe(adapter.glue.motion);
  });

  it('exports persistent regions and imports them back, then restarts', async () => {
    const { dev, adapter } = await loaded();
    const { data, extension } = await dev.exportDevice();
    expect(extension).toBe('dotbench-device');
    await dev.importDevice(data);
    expect(adapter.calls).toContain('importPersist nvs');
    expect(adapter.calls.at(-1)).toBe('restart');
  });

  it('prefers the adapter whole-device export/import when it has one', async () => {
    const adapter = new FakeAdapter();
    adapter.exportDevice = () => new Uint8Array([1, 2, 3]);
    adapter.importDevice = async (d) => {
      adapter.calls.push('importDevice ' + d.length);
    };
    const { dev } = make(adapter);
    await dev.load(new ArrayBuffer(1), { name: 'x' });
    expect([...(await dev.exportDevice()).data]).toEqual([1, 2, 3]);
    await dev.importDevice(new Uint8Array([9, 9]));
    expect(adapter.calls).toContain('importDevice 2');
    expect(adapter.calls).not.toContain('importPersist nvs');
  });

  it('is a RealDevice and disposes the adapter', async () => {
    const { dev, adapter } = await loaded();
    expect(isRealDevice(dev)).toBe(true);
    dev.dispose();
    expect(adapter.calls).toContain('dispose');
    await expect(dev.load(new ArrayBuffer(1), { name: 'x' })).rejects.toThrow(/disposed/);
  });
});
