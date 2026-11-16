/**
 * KodeDevice: the single seam between the page and the firmware side.
 *
 * The page only ever talks to this interface. Two implementations exist:
 *   - MockDevice (mock.ts): draws a test screen, no firmware involved.
 *   - WasmDevice (wasm.ts): placeholder for the real C app compiled to WebAssembly.
 *
 * Conventions
 *  - Everything the page can *observe* is an `Observable` (get + subscribe), so
 *    React can bind with useSyncExternalStore. Values are immutable snapshots.
 *  - The screen is *pulled* (`getFrame`), not pushed: the page calls it once per
 *    animation frame and repaints only when `seq` changed.
 *  - Hardware areas that arrive later (nfc, rfid, wifi, ...) are plugged in
 *    through `HardwareAreas` interface augmentation, see the bottom of the file.
 */

export type Unsubscribe = () => void;

/** A readable, subscribable value. `get()` must be cheap and referentially stable between changes. */
export interface Observable<T> {
  get(): T;
  /** Listener is called after every change (not immediately). Returns an unsubscribe function. */
  subscribe(listener: (value: T) => void): Unsubscribe;
}

// ---------------------------------------------------------------- lifecycle

export type DeviceStatus = 'idle' | 'booting' | 'running' | 'crashed';

export interface LoadOptions {
  /** Display name of the bundle (file name without extension is fine). */
  name: string;
}

// ------------------------------------------------------------------- screen

export const SCREEN_WIDTH = 410;
export const SCREEN_HEIGHT = 502;

export interface Frame {
  /** Increases every time the picture changes. Equal seq => same pixels, skip the repaint. */
  seq: number;
  width: number; // always SCREEN_WIDTH
  height: number; // always SCREEN_HEIGHT
  /**
   * RGBA, row-major, width*height*4 bytes. Must be backed by a plain ArrayBuffer
   * (ImageData rejects SharedArrayBuffer views: copy out of wasm shared memory).
   */
  data: Uint8ClampedArray;
}

// ------------------------------------------------------------------- inputs

export type ButtonId = 'top' | 'bottom' | 'up' | 'down' | 'left' | 'right';
export const BUTTON_IDS: readonly ButtonId[] = ['top', 'bottom', 'up', 'down', 'left', 'right'];

// ------------------------------------------------------------------ outputs

export interface Rgb {
  r: number; // 0..255
  g: number;
  b: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'input';

export interface LogLine {
  /** Monotonic per device, survives `clear()`; useful as a React key. */
  id: number;
  /** Epoch milliseconds. */
  ts: number;
  level: LogLevel;
  text: string;
}

export interface LogStream extends Observable<readonly LogLine[]> {
  clear(): void;
}

// ------------------------------------------------------------------- device

export interface DeviceInfo {
  /** Stable machine name: 'mock' | 'wasm' | ... */
  kind: string;
  /** Human label (pt-BR) for the status bar. */
  label: string;
  /** False when `load()` cannot run a real app (the mock). The page uses it to word its messages. */
  runsBundles: boolean;
}

export interface KodeDevice {
  readonly info: DeviceInfo;

  // lifecycle ---------------------------------------------------------------
  /** Hand over a .dotbench bundle. May reject (e.g. adapter not wired, bad bundle). Does not start it. */
  load(bundle: ArrayBuffer, options: LoadOptions): Promise<void>;
  start(): Promise<void>;
  stop(): void;
  /** Stop, then start the currently loaded app again. */
  restart(): Promise<void>;
  /** Release timers, workers, memory. The instance is unusable afterwards. */
  dispose(): void;

  readonly status: Observable<DeviceStatus>;
  /** Name of the running/loaded app, or null. */
  readonly appName: Observable<string | null>;

  // screen ------------------------------------------------------------------
  /** Latest picture. Cheap when nothing changed (return the same object). */
  getFrame(): Frame;
  /** Backlight 0..100. */
  readonly backlight: Observable<number>;
  /** false => panel off, the page shows black regardless of the frame. */
  readonly panelOn: Observable<boolean>;

  // inputs ------------------------------------------------------------------
  setButton(id: ButtonId, pressed: boolean): void;
  /** Screen coordinates in 0..SCREEN_WIDTH-1 / 0..SCREEN_HEIGHT-1. `down=false` is a release at x,y. */
  setTouch(x: number, y: number, down: boolean): void;

  // outputs -----------------------------------------------------------------
  readonly led: Observable<Rgb>;
  /** Vibration motor strength 0..1. */
  readonly haptic: Observable<number>;
  readonly log: LogStream;
  /**
   * One line typed by the user into the console. Implementations echo it into
   * `log` with level 'input' (the page does not echo), then deliver it to the app.
   */
  sendConsole(line: string): void;

  /** Device clock (RTC), epoch milliseconds. */
  time(): number;

  // hardware areas ----------------------------------------------------------
  /** Extensible registry, see HardwareAreas. An area is absent when the device does not implement it. */
  readonly areas: Readonly<Partial<HardwareAreas>>;
}

// ------------------------------------------------------------- area registry

/**
 * Names reserved for the hardware areas of the bench. Each area lives in its own
 * file (device/<area>.ts) and registers its API by augmenting `HardwareAreas`:
 *
 *   // device/motion.ts
 *   declare module './types' {
 *     interface HardwareAreas { motion: MotionArea }
 *   }
 *
 * so adding an area never edits this file's existing members. Planned areas:
 * nfc, rfid, wifi, ble, ir, sd, usb, power, motion.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HardwareAreas {}
export type AreaKey = keyof HardwareAreas;
