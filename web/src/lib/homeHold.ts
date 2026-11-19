import { Atom } from '../device/observable';
import type { ButtonId, KodeDevice, Observable } from '../device/types';
import { isRealDevice, type RealDevice } from '../device/wasm';
import { loadPref, savePref } from './prefs';

/**
 * The "hold the bottom button to go home" bar.
 *
 * The rule is the firmware's, not the page's. kode-sdk (kqp_config.h) defines KODE_HOME_HOLD_MS = 3000: AO_Buttons counts
 * it from the press and publishes BUTTON_HOME_HOLD_SIG; an app built with CONFIG_KODEOS_HOME_HOLD (the default) has
 * AO_Boot announce HOME_SIG and reset the board KODE_SYS_HOME_GRACE_MS = 200 later, so the app is really left 3200 ms
 * after the press (measured: scripts/hold-measure.mjs, 3295..3359 ms from the press to the firmware's own restart
 * request, the rest being the button's debounce and the page's polling). kodeOS has no home hold. An app may bring its
 * own gesture instead (Kody Kart: 1000 ms, its own kart_ao.c), or reset on the press itself (display_lvgl, buttons_led:
 * under 100 ms), so the duration is per app: `HOME_HOLD_BY_PROJECT` below, then what the page itself saw the app do last
 * time (`learned`), then the SDK's.
 *
 * The bar is only an estimate that moves with the clock; the firmware decides. It never reaches its end by time alone: it
 * waits at HOLD_CAP until the device really leaves the app (status leaves "running"), and only then jumps to full.
 *
 * A heavy app (KodeCity drawing flat out) can starve the firmware's own clock in a busy browser, and an app may have no hold
 * gesture at all, so a hold that is still down OVERDUE_MS past the expected time sends the Dot home from the page itself
 * (the same as the menu's "back to kodeOS"): holding the button always gets you out.
 */

/** KODE_HOME_HOLD_MS + KODE_SYS_HOME_GRACE_MS (kode-sdk v0.1.5, kqp_config.h). A test compares these with the pinned SDK. */
export const SDK_HOME_HOLD_MS = 3000;
export const SDK_HOME_GRACE_MS = 200;
export const DEFAULT_HOME_HOLD_MS = SDK_HOME_HOLD_MS + SDK_HOME_GRACE_MS;

/**
 * Apps whose gesture is not the SDK's, by project name, in ms from the press to leaving (0: it leaves on the press itself,
 * so there is nothing to show). Values are scripts/hold-measure.mjs's, rounded down to the firmware's own number plus its
 * 100 ms of restart latency where there is one.
 */
export const HOME_HOLD_BY_PROJECT: Readonly<Record<string, number>> = {
  kody_kart: 1100,
  display_lvgl: 0,
  buttons_led: 0,
};

/** The bar waits at this fraction until the firmware really leaves. */
export const HOLD_CAP = 0.97;
/** An ordinary press must not flash the bar. */
export const SHOW_AFTER_MS = 200;
/** How long past the expected time a still-held button waits for the firmware before the page sends the Dot home itself. */
export const OVERDUE_MS = 1200;
const FADE_MS = 120;
const DONE_SHOW_MS = 160;

export function homeHoldMs(project: string | undefined, learned?: number | null): number {
  if (project && Object.prototype.hasOwnProperty.call(HOME_HOLD_BY_PROJECT, project)) return HOME_HOLD_BY_PROJECT[project];
  if (typeof learned === 'number' && learned >= 300 && learned <= 10_000) return learned;
  return DEFAULT_HOME_HOLD_MS;
}

export type HoldPhase = 'idle' | 'holding' | 'done';

export interface HoldView {
  phase: HoldPhase;
  /** 0..1 as drawn */
  fraction: number;
  /** 0..1 opacity as drawn; 0 = nothing on the screen */
  alpha: number;
}

const NONE: HoldView = { phase: 'idle', fraction: 0, alpha: 0 };

/** The timing of one press, with no clock and no DOM of its own: every method takes `now` (ms). */
export class HomeHoldModel {
  private pressedAt: number | null = null;
  private holdMs = DEFAULT_HOME_HOLD_MS;
  private releasedAt: number | null = null;
  private leftAt: number | null = null;
  private lastFraction = 0;

  constructor(private reducedMotion: () => boolean = () => false) {}

  get pressed(): boolean {
    return this.pressedAt !== null && this.releasedAt === null && this.leftAt === null;
  }

  /** The bottom button went down while an app was running; `holdMs` is how long its gesture takes (0: instant). */
  press(now: number, holdMs: number): void {
    this.pressedAt = now;
    this.holdMs = holdMs;
    this.releasedAt = null;
    this.leftAt = null;
    this.lastFraction = 0;
  }

  /** The button went up before the app was left. */
  release(now: number): void {
    if (this.pressedAt === null || this.releasedAt !== null || this.leftAt !== null) return;
    this.releasedAt = now;
  }

  /** The firmware left the app. Returns how long the press had lasted (what the app's gesture really took), or null. */
  leave(now: number): number | null {
    if (this.pressedAt === null || this.releasedAt !== null || this.leftAt !== null) return null;
    this.leftAt = now;
    return now - this.pressedAt;
  }

  /** The button is still down this long past the app's own gesture time (only while it is down and the app was not left). */
  overdue(now: number, extra: number): boolean {
    return this.pressed && this.holdMs > 0 && now - (this.pressedAt as number) >= this.holdMs + extra;
  }

  reset(): void {
    this.pressedAt = null;
    this.releasedAt = null;
    this.leftAt = null;
  }

  view(now: number): HoldView {
    if (this.pressedAt === null) return NONE;
    const fade = this.reducedMotion() ? 0 : FADE_MS;
    if (this.leftAt !== null) {
      const since = now - this.leftAt;
      if (since >= DONE_SHOW_MS + fade) return NONE;
      const alpha = fade === 0 || since < DONE_SHOW_MS ? 1 : 1 - (since - DONE_SHOW_MS) / fade;
      return { phase: 'done', fraction: 1, alpha };
    }
    const start = this.pressedAt + SHOW_AFTER_MS;
    if (this.releasedAt !== null) {
      // released early: the bar goes (a short fade, none with reduced motion)
      const since = now - this.releasedAt;
      if (fade === 0 || since >= fade || this.releasedAt < start) return NONE;
      return { phase: 'holding', fraction: this.lastFraction, alpha: 1 - since / fade };
    }
    if (now < start) return NONE;
    const fraction = Math.min(HOLD_CAP, (now - this.pressedAt) / Math.max(1, this.holdMs));
    this.lastFraction = fraction;
    const alpha = fade === 0 ? 1 : Math.min(1, (now - start) / fade);
    return { phase: 'holding', fraction, alpha };
  }
}

// ------------------------------------------------------------------ the page side

export interface HoldState {
  phase: HoldPhase;
  /** 0..100 in steps of 5, for the screen-reader progress bar and the tests */
  percent: number;
}
export const HOLD_IDLE: HoldState = { phase: 'idle', percent: 0 };

const LEARN_KEY = 'dotbench.homeHold';

export interface HomeHoldDeps {
  input: { pressed: Observable<ReadonlySet<ButtonId>> };
  device: KodeDevice;
  now?: () => number;
  reducedMotion?: () => boolean;
  /** Sends the Dot back to kodeOS from the page (used when the firmware does not leave on time) */
  goHome?: () => void;
  /** localStorage-like store for what the page learned, or null */
  learn?: { load(): Record<string, number>; save(v: Record<string, number>): void } | null;
}

/**
 * Watches the bottom button and the running program, and keeps the model in step. `draw` is called by the screen painter
 * once per animation frame; it paints the bar on top of the picture and says whether it drew anything.
 */
export class HomeHoldController {
  readonly state = new Atom<HoldState>(HOLD_IDLE);
  private model: HomeHoldModel;
  private now: () => number;
  private offs: Array<() => void> = [];
  private down = false;
  private projectOfPress: string | undefined;
  private learned: Record<string, number>;
  private learnStore: NonNullable<HomeHoldDeps['learn']> | null;
  private label = '';
  private drawn = false;
  private forced = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private deps: HomeHoldDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.model = new HomeHoldModel(deps.reducedMotion);
    this.learnStore =
      deps.learn === undefined
        ? {
            load: () => {
              const v = loadPref<unknown>(LEARN_KEY, {});
              return v && typeof v === 'object' ? (v as Record<string, number>) : {};
            },
            save: (v) => savePref(LEARN_KEY, v),
          }
        : deps.learn;
    this.learned = this.learnStore?.load() ?? {};
    this.offs.push(deps.input.pressed.subscribe((s) => this.onPressed(s.has('bottom'))));
    this.offs.push(deps.device.status.subscribe(() => this.onStatus()));
  }

  setLabel(text: string): void {
    this.label = text;
  }

  dispose(): void {
    this.clearTimer();
    this.offs.forEach((o) => o());
    this.offs = [];
  }

  private real(): RealDevice | null {
    return isRealDevice(this.deps.device) ? this.deps.device : null;
  }

  private appProject(): string | undefined {
    const d = this.real();
    const p = d?.program.get();
    if (!d || !p) return undefined;
    return d.apps.get().find((a) => a.id === p.id)?.project;
  }

  private inApp(): boolean {
    const d = this.real();
    return !!d && d.status.get() === 'running' && d.program.get()?.kind === 'app';
  }

  private onPressed(bottom: boolean): void {
    if (bottom === this.down) return;
    this.down = bottom;
    if (bottom) {
      if (!this.inApp()) return;
      this.projectOfPress = this.appProject();
      const ms = homeHoldMs(this.projectOfPress, this.projectOfPress ? this.learned[this.projectOfPress] : undefined);
      this.forced = false;
      this.model.press(this.now(), ms);
      // a timer as well as the painter's frames: a hidden tab paints nothing
      this.clearTimer();
      if (ms > 0) this.timer = setTimeout(() => this.check(), ms + OVERDUE_MS + 50);
    } else {
      this.clearTimer();
      this.model.release(this.now());
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The firmware has not left the app well past its time while the button is still down: the page sends the Dot home. */
  check(): void {
    if (this.forced || !this.deps.goHome || !this.model.overdue(this.now(), OVERDUE_MS) || !this.inApp()) return;
    this.forced = true;
    this.deps.goHome();
  }

  private onStatus(): void {
    if (this.deps.device.status.get() === 'running') return;
    const lasted = this.model.leave(this.now());
    if (lasted !== null) this.clearTimer();
    if (this.forced) return; // the page sent it home: that says nothing about the app's own gesture
    // what the app's gesture really took, kept for the next press (only a plausible hold counts, and never over a known rule)
    if (lasted !== null && this.projectOfPress && lasted >= 300 && lasted <= 10_000 && !(this.projectOfPress in HOME_HOLD_BY_PROJECT)) {
      this.learned = { ...this.learned, [this.projectOfPress]: Math.round(lasted) };
      this.learnStore?.save(this.learned);
    }
  }

  /** One animation frame. `ctx` is the screen canvas context; returns true when something was drawn (the screen must repaint). */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    this.check();
    const v = this.model.view(this.now());
    const percent = v.phase === 'idle' ? 0 : Math.round((v.fraction * 100) / 5) * 5;
    this.state.set(v.phase === this.state.get().phase && percent === this.state.get().percent ? this.state.get() : { phase: v.phase, percent });
    this.drawn = v.alpha > 0;
    if (!this.drawn) return false; // the painter wipes the last bar by itself
    paintBar(ctx, w, h, v, this.label);
    return true;
  }
}

// ---------------------------------------------------------------- drawing

const AMBER = '#FFAC00';
const PANEL = 'rgba(25, 25, 25, 0.86)';
const TRACK = 'rgba(255, 255, 255, 0.2)';
const INK = '#F4EEE4';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The bar, centred on the screen picture (410 x 502): a dark rounded plate, the label, a track and the amber fill. */
export function paintBar(ctx: CanvasRenderingContext2D, w: number, h: number, v: HoldView, label: string): void {
  const pw = 312;
  const ph = 88;
  const x = Math.round((w - pw) / 2);
  const y = Math.round((h - ph) / 2);
  ctx.save();
  ctx.globalAlpha = v.alpha;
  roundRect(ctx, x, y, pw, ph, 30);
  ctx.fillStyle = PANEL;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let size = 21;
  ctx.font = `600 ${size}px "DM Sans", system-ui, sans-serif`;
  while (size > 11 && ctx.measureText(label).width > pw - 40) ctx.font = `600 ${--size}px "DM Sans", system-ui, sans-serif`;
  ctx.fillText(label, w / 2, y + 38);
  const bw = pw - 52;
  const bh = 14;
  const bx = x + 26;
  const by = y + 54;
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fillStyle = TRACK;
  ctx.fill();
  const fw = Math.max(bh, bw * v.fraction);
  if (v.fraction > 0) {
    roundRect(ctx, bx, by, fw, bh, bh / 2);
    ctx.fillStyle = AMBER;
    ctx.fill();
  }
  ctx.restore();
}
