/**
 * The Workbench camera: it circles a point on the table. Orbit, pan and zoom set goals; `step` moves the shown values
 * towards them (no allocations per frame). The camera never goes under the table and never loses the table from sight.
 */
import { Vector3 } from 'three';
import { STRONG, magnet, magnetRelease, magnetStart, quarterMarks, type MagnetState, type Mark } from '../lib/magnet';
import { DESK, DOT, type Rect } from './layout';

const DEG = Math.PI / 180;
export const POLAR_MIN = 2 * DEG; // straight down (almost: the up vector must stay defined)
export const POLAR_MAX = 78 * DEG; // never level with, or under, the table
export const DIST_MIN = 120;
export const DIST_MAX = 2100;
export const WB_FOV = 30;
/** Where the view's turn catches: the four straight directions, and straight down (as far down as the camera goes). */
const AZ_MARKS: Mark[] = quarterMarks(0, 359.999, false);
const POL_MARKS: Mark[] = [{ at: POLAR_MIN / DEG, pull: STRONG }];

export interface View {
  x: number;
  z: number;
  /** Turn about the vertical: 0 looks from the front (the Dot upright on screen). */
  az: number;
  /** Angle from the vertical. */
  pol: number;
  dist: number;
}

export class OrbitRig {
  goal: View = { x: 0, z: 0, az: 0, pol: 34 * DEG, dist: 620 };
  cur: View = { ...this.goal };
  /** Outputs of `step`. */
  readonly pos = new Vector3();
  readonly look = new Vector3();
  /** The point looked at sits a little above the table, at about the height of the things on it. */
  lookY = 8;

  private clamp(): void {
    const g = this.goal;
    g.pol = Math.min(POLAR_MAX, Math.max(POLAR_MIN, g.pol));
    g.dist = Math.min(DIST_MAX, Math.max(DIST_MIN, g.dist));
    g.x = Math.min(DESK.x1, Math.max(DESK.x0, g.x));
    g.z = Math.min(DESK.z1, Math.max(DESK.z0, g.z));
  }

  /** The hand's own angles during a drag (the goal is what the magnet makes of them), and what the drag is caught on. */
  private raw: { az: number; pol: number; magAz: MagnetState; magPol: MagnetState } | null = null;
  /** A drag that turns the view begins: from here the turn catches on the four straight directions and on straight down. */
  orbitBegin(): void {
    this.raw = { az: this.goal.az, pol: this.goal.pol, magAz: magnetStart(this.goal.az / DEG, AZ_MARKS, 360), magPol: magnetStart(this.goal.pol / DEG, POL_MARKS) };
  }
  /**
   * Drag by pixels: a full turn is about two widths of the view. The view catches when it looks along the table's own
   * lines (from the front, the back, either side) and when it looks straight down (lib/magnet.ts); `off` (Alt) turns
   * that off, `reduced` leaves out the easing.
   */
  orbit(dxPx: number, dyPx: number, o: { off?: boolean; reduced?: boolean } = {}): void {
    if (!this.raw) this.orbitBegin();
    const r = this.raw!;
    r.az -= dxPx * 0.0052;
    r.pol = Math.min(POLAR_MAX, Math.max(POLAR_MIN, r.pol - dyPx * 0.0045));
    this.goal.az = magnet(r.az / DEG, AZ_MARKS, r.magAz, { ...o, period: 360 }) * DEG;
    this.goal.pol = magnet(r.pol / DEG, POL_MARKS, r.magPol, o) * DEG;
    this.clamp();
  }
  /** The drag ends: let go inside a mark's window, the view is exactly on the mark. */
  orbitEnd(o: { off?: boolean } = {}): void {
    const r = this.raw;
    this.raw = null;
    if (!r) return;
    this.goal.az = magnetRelease(r.az / DEG, r.magAz, { ...o, period: 360 }) * DEG;
    this.goal.pol = magnetRelease(r.pol / DEG, r.magPol, o) * DEG;
    this.clamp();
  }
  /** Slide the table under the pointer by pixels (the point under the pointer stays under it, to first order). */
  pan(dxPx: number, dyPx: number, viewportH: number, fovDeg = WB_FOV): void {
    const g = this.goal;
    const perPx = (2 * g.dist * Math.tan((fovDeg * DEG) / 2)) / Math.max(1, viewportH);
    const c = Math.cos(g.az), s = Math.sin(g.az);
    // right = (c, 0, -s); forward on the table = (-s, 0, -c); a vertical drag covers more table the flatter the view
    const fwd = (dyPx * perPx) / Math.max(0.3, Math.cos(g.pol));
    g.x += -dxPx * perPx * c - s * fwd;
    g.z += dxPx * perPx * s - c * fwd;
    this.clamp();
  }
  zoom(factor: number): void {
    this.goal.dist *= factor;
    this.clamp();
  }

  /** Frame a rectangle of the table (with what stands on it up to `height`) for a view of the given aspect. */
  frame(r: Rect, height: number, aspect: number, o: { pol?: number; az?: number; margin?: number; fovDeg?: number } = {}): void {
    const g = this.goal;
    const pol = o.pol ?? g.pol;
    const margin = o.margin ?? 1.16;
    const t = Math.tan(((o.fovDeg ?? WB_FOV) * DEG) / 2);
    const hw = (r.x1 - r.x0) / 2, hd = (r.z1 - r.z0) / 2;
    const az = o.az ?? 0;
    // half extents as the camera sees them
    const c = Math.abs(Math.cos(az)), s = Math.abs(Math.sin(az));
    const halfW = hw * c + hd * s;
    const halfV = (hd * c + hw * s) * Math.cos(pol) + height * Math.sin(pol);
    g.x = (r.x0 + r.x1) / 2;
    g.z = (r.z0 + r.z1) / 2;
    // seen from an angle, what stands on the table rises above its far edge: aim a little this side of the middle
    const lean = Math.sin(pol) * (0.1 * (hd * c + hw * s) + height * 0.25);
    g.x += Math.sin(az) * lean;
    g.z += Math.cos(az) * lean;
    g.az = nearestTurn(az, this.cur.az);
    g.pol = pol;
    g.dist = Math.max((halfV * margin) / t, (halfW * margin) / (t * Math.max(0.2, aspect))) + (hd * c + hw * s) * Math.sin(pol);
    this.clamp();
  }
  /** Close on the Dot: its screen is easy to read and to touch. */
  focusDot(aspect: number): void {
    this.frame({ x0: -DOT.hw, x1: DOT.hw, z0: -DOT.hd, z1: DOT.hd }, DOT.h, aspect, { pol: 16 * DEG, az: 0, margin: 1.5 });
  }

  jump(): void {
    Object.assign(this.cur, this.goal);
    this.place();
  }

  /** Moves the shown view towards the goal; true while it is still moving. */
  step(dt: number, reduced: boolean): boolean {
    const c = this.cur, g = this.goal;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 14);
    c.x += (g.x - c.x) * k;
    c.z += (g.z - c.z) * k;
    c.az += (g.az - c.az) * k;
    c.pol += (g.pol - c.pol) * k;
    c.dist += (g.dist - c.dist) * k;
    const busy = Math.abs(g.x - c.x) > 0.02 || Math.abs(g.z - c.z) > 0.02 || Math.abs(g.az - c.az) > 0.0004 || Math.abs(g.pol - c.pol) > 0.0004 || Math.abs(g.dist - c.dist) > 0.05;
    if (!busy) Object.assign(c, g);
    this.place();
    return busy;
  }

  private place(): void {
    const c = this.cur;
    const sp = Math.sin(c.pol), cp = Math.cos(c.pol);
    this.look.set(c.x, this.lookY, c.z);
    this.pos.set(c.x + c.dist * sp * Math.sin(c.az), this.lookY + c.dist * cp, c.z + c.dist * sp * Math.cos(c.az));
  }
}

/** The angle equal to `a` (mod a full turn) that is nearest to `ref`, so a reset never spins the long way round. */
export function nearestTurn(a: number, ref: number): number {
  const two = Math.PI * 2;
  return a + Math.round((ref - a) / two) * two;
}
