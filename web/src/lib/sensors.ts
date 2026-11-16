import type { MotionPose } from '../device/motion';
import type { TKey } from '../i18n/core';
import { wrapHeading } from './pose';

/**
 * W3C DeviceOrientation -> pose. A phone held upright facing the user (beta=90)
 * is the neutral pose (0,0,0), same convention as the 3D model.
 */
export function orientationToPose(alpha: number | null, beta: number | null, gamma: number | null): MotionPose | null {
  if (beta == null && gamma == null && alpha == null) return null;
  const c = (v: number, m: number) => Math.min(m, Math.max(-m, v));
  return {
    pitch: Math.round(c((beta ?? 90) - 90, 90)),
    roll: Math.round(c(gamma ?? 0, 90)),
    heading: Math.round(wrapHeading(alpha ?? 0)),
  };
}

/** Detects a shake: `hits` strong accelerations within `windowMs`, then a cooldown. */
export class ShakeDetector {
  private times: number[] = [];
  private lastShake = -Infinity;
  constructor(
    private threshold = 14, // m/s^2, gravity removed
    private hits = 3,
    private windowMs = 700,
    private cooldownMs = 1200,
  ) {}

  /** Feed acceleration WITHOUT gravity. Returns true when a shake just happened. */
  feed(ax: number, ay: number, az: number, t: number): boolean {
    if (Math.hypot(ax, ay, az) < this.threshold) return false;
    this.times = this.times.filter((x) => t - x <= this.windowMs);
    this.times.push(t);
    if (this.times.length >= this.hits && t - this.lastShake >= this.cooldownMs) {
      this.lastShake = t;
      this.times = [];
      return true;
    }
    return false;
  }
}

export type SensorStartResult = { ok: true } | { ok: false; reason: TKey };

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Real phone sensors. Must be started from a user gesture (iOS permission prompt).
 * Not verifiable without a real device, see docs/STATUS-web.md.
 */
export class SensorBridge {
  private running = false;
  private shake = new ShakeDetector();
  private gotData = false;
  private timer = 0;

  constructor(
    private onPose: (p: MotionPose) => void,
    private onShake: () => void,
    private onNoData: () => void,
  ) {}

  async start(): Promise<SensorStartResult> {
    if (typeof window === 'undefined' || !('DeviceOrientationEvent' in window)) {
      return { ok: false, reason: 'sensors.unsupported' };
    }
    try {
      for (const api of [window.DeviceOrientationEvent, (window as unknown as { DeviceMotionEvent?: PermissionApi }).DeviceMotionEvent] as PermissionApi[]) {
        if (api && typeof api.requestPermission === 'function') {
          const r = await api.requestPermission();
          if (r !== 'granted') {
            return { ok: false, reason: 'sensors.denied' };
          }
        }
      }
    } catch {
      return { ok: false, reason: 'sensors.permissionError' };
    }
    window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('devicemotion', this.onMotion);
    this.running = true;
    this.gotData = false;
    this.timer = window.setTimeout(() => {
      if (this.running && !this.gotData) this.onNoData();
    }, 1500);
    return { ok: true };
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    clearTimeout(this.timer);
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('devicemotion', this.onMotion);
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    const p = orientationToPose(e.alpha, e.beta, e.gamma);
    if (!p) return;
    this.gotData = true;
    this.onPose(p);
  };

  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.acceleration;
    if (a && a.x != null && a.y != null && a.z != null) {
      this.gotData = true;
      if (this.shake.feed(a.x, a.y, a.z, performance.now())) this.onShake();
    }
  };
}

/** Haptic output on phones. Feature-detected, never throws, only after a user gesture. */
export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
