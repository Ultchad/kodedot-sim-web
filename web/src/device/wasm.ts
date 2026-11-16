/**
 * WasmDevice: PLACEHOLDER adapter for the real firmware. Not wired yet.
 *
 * What the real adapter will need (written for whoever builds it):
 *
 * 1. Bundle format: a `.dotbench` file is a zip holding an Emscripten ES module
 *    (`app.js`), its `app.wasm`, `app.json` (name, version) and an icon.
 *    `load()` receives the zip as an ArrayBuffer; unzip it in the page (no
 *    library in this project yet: a stored/deflate reader is ~100 lines), put the
 *    two files behind blob: URLs and `import()` the JS module with
 *    `locateFile` pointing at the wasm blob URL. Keep bundles out of the main thread
 *    where possible.
 * 2. Threads: the wasm is built with pthreads (-pthread, -sPROXY_TO_PTHREAD), so
 *    the page MUST be cross-origin isolated (COOP same-origin + COEP require-corp).
 *    vercel.json and the Vite dev/preview servers already send both headers and
 *    the status bar shows `crossOriginIsolated`. Check it in start() and fail with
 *    a clear message when false.
 * 3. Shared state: the C side owns a `kweb_state_t` (framebuffer 410x502 RGBA,
 *    frame counter, backlight, panel on/off, LED rgb, haptic, log queue). Wrap it
 *    in typed views over `Module.HEAPU8` (a SharedArrayBuffer). `getFrame()` must
 *    COPY the framebuffer into a plain Uint8ClampedArray (ImageData rejects SAB
 *    views) and reuse the same Frame object while the C frame counter is unchanged.
 * 4. Exports: `kweb_button`, `kweb_touch`, `kweb_console`, plus one per bench
 *    object. Each hardware area gets a typed wrapper in device/<area>.ts and is
 *    exposed through `areas` (see MotionArea / HardwareAreas in types.ts).
 * 5. Log/console: drain the circular queue on a timer or rAF and push into a
 *    LogBuffer; echo sendConsole() input with level 'input'.
 * 6. Status: idle -> booting (module instantiating / app_main running) -> running
 *    (first frame) ; crashed on abort()/unhandled worker error.
 */
import { Atom, LogBuffer } from './observable';
import {
  SCREEN_HEIGHT,
  SCREEN_WIDTH,
  type ButtonId,
  type DeviceInfo,
  type DeviceStatus,
  type Frame,
  type HardwareAreas,
  type KodeDevice,
  type LoadOptions,
  type LogStream,
  type Observable,
  type Rgb,
} from './types';

export class NotWiredError extends Error {
  constructor() {
    super('WebAssembly adapter not wired yet.');
    this.name = 'NotWiredError';
  }
}

export class WasmDevice implements KodeDevice {
  readonly info: DeviceInfo = { kind: 'wasm', label: 'WebAssembly (not wired)', runsBundles: true };

  private _status = new Atom<DeviceStatus>('idle');
  private _appName = new Atom<string | null>(null);
  private _backlight = new Atom(100);
  private _panelOn = new Atom(true);
  private _led = new Atom<Rgb>({ r: 0, g: 0, b: 0 });
  private _haptic = new Atom(0);
  private _log = new LogBuffer();
  private blank: Frame = {
    seq: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    data: new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4),
  };

  readonly status: Observable<DeviceStatus> = this._status;
  readonly appName: Observable<string | null> = this._appName;
  readonly backlight: Observable<number> = this._backlight;
  readonly panelOn: Observable<boolean> = this._panelOn;
  readonly led: Observable<Rgb> = this._led;
  readonly haptic: Observable<number> = this._haptic;
  readonly log: LogStream = this._log;
  readonly areas: Readonly<Partial<HardwareAreas>> = {};

  constructor() {
    for (let i = 3; i < this.blank.data.length; i += 4) this.blank.data[i] = 255; // opaque black
  }

  async load(_bundle: ArrayBuffer, _options: LoadOptions): Promise<void> {
    throw new NotWiredError();
  }
  async start(): Promise<void> {
    throw new NotWiredError();
  }
  async restart(): Promise<void> {
    throw new NotWiredError();
  }
  stop(): void {
    /* nothing running */
  }
  dispose(): void {
    /* nothing allocated */
  }

  getFrame(): Frame {
    return this.blank;
  }
  setButton(_id: ButtonId, _pressed: boolean): void {}
  setTouch(_x: number, _y: number, _down: boolean): void {}
  sendConsole(_line: string): void {}
  time(): number {
    return Date.now();
  }
}
