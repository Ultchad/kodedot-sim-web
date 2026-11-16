/**
 * MockDevice: stand-in for the firmware, good enough to build the whole UI.
 * Draws an animated test screen (clock, counter, button chips, touch dot,
 * motion readout), cycles the LED on the top button, pulses haptic on the
 * bottom button, and answers a few console commands. No WebAssembly.
 */
import type { MotionArea, MotionPose } from './motion';
import { Atom, LogBuffer } from './observable';
import {
  BUTTON_IDS,
  SCREEN_HEIGHT as H,
  SCREEN_WIDTH as W,
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

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const SANS = 'ui-sans-serif, system-ui, "Segoe UI", sans-serif';
const BOOT_MS = 700;
const FRAME_MS = 33;
const HAPTIC_PULSE_MS = 260;

const GREEN: Rgb = { r: 40, g: 220, b: 90 };
const RED: Rgb = { r: 235, g: 50, b: 50 };

const BUTTON_GLYPH: Record<ButtonId, string> = { top: 'T', bottom: 'B', up: '▲', down: '▼', left: '◀', right: '▶' };

function makeCanvas(): { ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas not available');
  return { ctx };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export class MockDevice implements KodeDevice {
  readonly info: DeviceInfo = { kind: 'mock', label: 'Test device (mock)', runsBundles: false };

  private _status = new Atom<DeviceStatus>('idle');
  private _appName = new Atom<string | null>('Test screen (mock)');
  private _backlight = new Atom(100);
  private _panelOn = new Atom(true);
  private _led = new Atom<Rgb>({ r: 0, g: 0, b: 0 });
  private _haptic = new Atom(0);
  private _log = new LogBuffer();

  readonly status: Observable<DeviceStatus> = this._status;
  readonly appName: Observable<string | null> = this._appName;
  readonly backlight: Observable<number> = this._backlight;
  readonly panelOn: Observable<boolean> = this._panelOn;
  readonly led: Observable<Rgb> = this._led;
  readonly haptic: Observable<number> = this._haptic;
  readonly log: LogStream = this._log;

  private motion: MotionArea = {
    setPose: (p) => {
      this.pose = p;
    },
    shake: (ms = 900) => {
      this.shakeUntil = performance.now() + ms;
      this.shakeCount++;
      this.info_(`motion: shake (${ms} ms)`);
    },
  };
  readonly areas: Readonly<Partial<HardwareAreas>> = { motion: this.motion };

  private ctx = makeCanvas().ctx;
  private frame: Frame = { seq: 0, width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootAt = 0;
  private counter = 0;
  private held = new Set<ButtonId>();
  private touch = { x: W / 2, y: H / 2, down: false, seen: false };
  private pose: MotionPose | null = null;
  private shakeUntil = 0;
  private shakeCount = 0;
  private ledStep = 0;
  private hapticAt = -Infinity;
  private dirty = true;
  private disposed = false;

  constructor() {
    this.timer = setInterval(this.tick, FRAME_MS);
    this.renderIdle();
  }

  // lifecycle ---------------------------------------------------------------
  async load(bundle: ArrayBuffer, options: LoadOptions): Promise<void> {
    this.warn(`the mock does not run apps: "${options.name}" (${bundle.byteLength} bytes) was received and ignored`);
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    this.bootAt = performance.now();
    this._status.set('booting');
    this.info_('boot: test device starting');
  }

  stop(): void {
    if (this._status.get() === 'idle') return;
    this._status.set('idle');
    this._led.set({ r: 0, g: 0, b: 0 });
    this._haptic.set(0);
    this.info_('stopped');
    this.renderIdle();
  }

  async restart(): Promise<void> {
    this.stop();
    this.counter = 0;
    await this.start();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // screen ------------------------------------------------------------------
  getFrame(): Frame {
    return this.frame;
  }

  // inputs ------------------------------------------------------------------
  setButton(id: ButtonId, pressed: boolean): void {
    if (!BUTTON_IDS.includes(id)) return;
    const was = this.held.has(id);
    if (pressed === was) return;
    if (pressed) this.held.add(id);
    else this.held.delete(id);
    this.dirty = true;
    if (this._status.get() !== 'running') return;
    this.info_(`button ${id} ${pressed ? 'pressed' : 'released'}`);
    if (!pressed) return;
    this.counter++;
    if (id === 'top') {
      this._led.set(this.ledStep++ % 2 === 0 ? GREEN : RED);
    } else if (id === 'bottom') {
      this.hapticAt = performance.now();
      this._haptic.set(0.8);
    }
  }

  setTouch(x: number, y: number, down: boolean): void {
    const wasDown = this.touch.down;
    this.touch = { x, y, down, seen: true };
    this.dirty = true;
    if (this._status.get() !== 'running') return;
    if (down && !wasDown) this.info_(`touch down at (${x}, ${y})`);
    else if (!down && wasDown) this.info_(`touch up at (${x}, ${y})`);
  }

  sendConsole(line: string): void {
    const text = line.trim();
    if (!text) return;
    this._log.push('input', `> ${text}`);
    const [cmd, ...args] = text.split(/\s+/);
    const num = (i: number) => Number(args[i]);
    switch (cmd.toLowerCase()) {
      case 'help':
        this.info_('commands: help, led <r> <g> <b>, haptic <0..1>, backlight <0..100>, panel on|off, crash, clear');
        break;
      case 'led':
        if ([0, 1, 2].every((i) => Number.isFinite(num(i)))) {
          const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
          this._led.set({ r: c(num(0)), g: c(num(1)), b: c(num(2)) });
          this.info_('led updated');
        } else this.warn('usage: led <r> <g> <b>  (0..255)');
        break;
      case 'haptic':
        if (Number.isFinite(num(0))) {
          this.hapticAt = performance.now();
          this._haptic.set(Math.max(0, Math.min(1, num(0))));
        } else this.warn('usage: haptic <0..1>');
        break;
      case 'backlight':
        if (Number.isFinite(num(0))) this._backlight.set(Math.max(0, Math.min(100, Math.round(num(0)))));
        else this.warn('usage: backlight <0..100>');
        break;
      case 'panel':
        if (args[0] === 'on' || args[0] === 'off') this._panelOn.set(args[0] === 'on');
        else this.warn('usage: panel on|off');
        break;
      case 'crash':
        this._status.set('crashed');
        this._log.push('error', 'abort(): simulated failure from the crash command');
        this.renderIdle();
        break;
      case 'clear':
        this._log.clear();
        break;
      default:
        this.warn(`unknown command: ${cmd} (type help)`);
    }
  }

  time(): number {
    return Date.now();
  }

  // internals ---------------------------------------------------------------
  private info_(t: string) {
    this._log.push('info', `[mock] ${t}`);
  }
  private warn(t: string) {
    this._log.push('warn', `[mock] ${t}`);
  }

  private tick = () => {
    const now = performance.now();
    const st = this._status.get();
    if (st === 'booting' && now - this.bootAt >= BOOT_MS) {
      this._status.set('running');
      this.info_('app (test screen) running');
    }
    const h = this._haptic.get();
    if (h > 0) {
      const k = 1 - (now - this.hapticAt) / HAPTIC_PULSE_MS;
      this._haptic.set(k <= 0 ? 0 : Math.min(h, 0.8 * k));
    }
    if (st === 'running' || st === 'booting') this.render(now);
    else if (this.dirty) this.renderIdle();
  };

  private publish() {
    const img = this.ctx.getImageData(0, 0, W, H);
    this.frame = { seq: this.frame.seq + 1, width: W, height: H, data: img.data };
    this.dirty = false;
  }

  private renderIdle() {
    const c = this.ctx;
    c.fillStyle = '#050607';
    c.fillRect(0, 0, W, H);
    c.fillStyle = this._status.get() === 'crashed' ? '#ef6b5d' : '#3a434d';
    c.font = `600 22px ${SANS}`;
    c.textAlign = 'center';
    c.fillText(this._status.get() === 'crashed' ? 'CRASHED' : 'STOPPED', W / 2, H / 2);
    this.publish();
  }

  private render(now: number) {
    const c = this.ctx;
    const t = new Date();
    const booting = this._status.get() === 'booting';

    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e1a24');
    g.addColorStop(1, '#070b10');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // faint grid
    c.strokeStyle = 'rgba(120,160,190,0.07)';
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= W; x += 41) (c.moveTo(x + 0.5, 0), c.lineTo(x + 0.5, H));
    for (let y = 0; y <= H; y += 41) (c.moveTo(0, y + 0.5), c.lineTo(W, y + 0.5));
    c.stroke();

    // the glass has ~9 mm rounded corners: keep text clear of them
    c.textAlign = 'center';
    c.fillStyle = '#6e8396';
    c.font = `600 12px ${MONO}`;
    c.fillText(booting ? 'TEST SCREEN · MOCK · BOOT' : 'TEST SCREEN · MOCK', W / 2, 38);

    if (booting) {
      const p = Math.min(1, (now - this.bootAt) / BOOT_MS);
      c.fillStyle = '#1b2733';
      c.fillRect(70, H / 2, W - 140, 6);
      c.fillStyle = '#e9a84a';
      c.fillRect(70, H / 2, (W - 140) * p, 6);
      this.publish();
      return;
    }

    // clock
    c.textAlign = 'center';
    c.fillStyle = '#e6edf3';
    c.font = `300 66px ${MONO}`;
    c.fillText(`${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`, W / 2, 112);

    // counter card
    c.fillStyle = 'rgba(255,255,255,0.045)';
    roundRect(c, 22, 140, W - 44, 104, 14);
    c.fill();
    c.fillStyle = '#6e8396';
    c.font = `600 12px ${MONO}`;
    c.textAlign = 'left';
    c.fillText('COUNTER (any button)', 40, 168);
    c.fillStyle = '#e9a84a';
    c.font = `300 56px ${MONO}`;
    c.fillText(String(this.counter), 40, 224);

    // sweep bar
    const sweep = (now / 1600) % 1;
    c.fillStyle = '#16202a';
    c.fillRect(22, 262, W - 44, 4);
    c.fillStyle = '#5fd0b8';
    c.fillRect(22 + (W - 44 - 60) * sweep, 262, 60, 4);

    // button chips
    const ids: ButtonId[] = ['top', 'bottom', 'up', 'down', 'left', 'right'];
    const chipW = 54;
    const gap = (W - 44 - chipW * 6) / 5;
    ids.forEach((id, i) => {
      const x = 22 + i * (chipW + gap);
      const on = this.held.has(id);
      c.fillStyle = on ? '#e9a84a' : 'rgba(255,255,255,0.06)';
      roundRect(c, x, 286, chipW, 44, 10);
      c.fill();
      c.fillStyle = on ? '#10151a' : '#8fa1b2';
      c.font = `600 16px ${MONO}`;
      c.textAlign = 'center';
      c.fillText(BUTTON_GLYPH[id], x + chipW / 2, 314);
    });

    // motion readout
    const shaking = now < this.shakeUntil;
    c.textAlign = 'left';
    c.fillStyle = '#6e8396';
    c.font = `600 12px ${MONO}`;
    c.fillText('MOTION', 22, 372);
    const cx = 80;
    const cy = 430;
    c.strokeStyle = '#2a3744';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, 44, 0, Math.PI * 2);
    c.stroke();
    const pose = this.pose;
    let bx = cx;
    let by = cy;
    if (pose) {
      bx += Math.max(-1, Math.min(1, pose.roll / 90)) * 34;
      by += Math.max(-1, Math.min(1, pose.pitch / 90)) * 34;
    }
    if (shaking) {
      bx += Math.sin(now / 18) * 8;
      by += Math.cos(now / 23) * 8;
    }
    c.fillStyle = pose ? '#5fd0b8' : '#3a434d';
    c.beginPath();
    c.arc(bx, by, 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#c9d4de';
    c.font = `500 15px ${MONO}`;
    if (pose) {
      c.fillText(`pitch   ${pose.pitch.toFixed(0).padStart(4)}°`, 150, 408);
      c.fillText(`roll    ${pose.roll.toFixed(0).padStart(4)}°`, 150, 430);
      c.fillText(`heading ${pose.heading.toFixed(0).padStart(4)}°`, 150, 452);
    } else {
      c.fillStyle = '#566472';
      c.fillText('no motion object', 150, 424);
    }
    c.fillStyle = shaking ? '#ef6b5d' : '#566472';
    c.font = `600 13px ${MONO}`;
    c.fillText(shaking ? 'SHAKING' : `shakes: ${this.shakeCount}`, 64, 484);

    // touch dot
    if (this.touch.seen) {
      const { x, y, down } = this.touch;
      c.strokeStyle = down ? 'rgba(233,168,74,0.55)' : 'rgba(233,168,74,0.18)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(x + 0.5, 0);
      c.lineTo(x + 0.5, H);
      c.moveTo(0, y + 0.5);
      c.lineTo(W, y + 0.5);
      c.stroke();
      c.fillStyle = down ? '#e9a84a' : 'rgba(233,168,74,0.35)';
      c.beginPath();
      c.arc(x, y, down ? 14 : 9, 0, Math.PI * 2);
      c.fill();
      c.textAlign = x > W - 90 ? 'right' : 'left';
      c.fillStyle = '#e9a84a';
      c.font = `500 11px ${MONO}`;
      c.fillText(`${x},${y}`, x + (x > W - 90 ? -18 : 18), y - 12);
    }
    this.publish();
  }
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
