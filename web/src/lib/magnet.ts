/**
 * Magnetic angles: wherever something is turned by hand, the angle catches on the marks that matter (the straight
 * ones, and more weakly the diagonals). One helper, so that it feels the same everywhere.
 *
 * The feel is a soft magnet, not a grid. Far from a mark the angle is the hand's. Coming within the mark's window the
 * angle is tugged toward it and eases onto it; close to the mark (the inner part of the window) it IS the mark,
 * exactly; to get away the hand has to go a little further than it took to get in, so the angle does not chatter at
 * the window's edge. Let go inside the window, and what is kept is the mark itself. A drag that begins on a mark leaves
 * it freely (a small correction from a straight angle is not held back); the mark catches again when the hand comes
 * back to it. Alt (the caller's `off`) turns the magnet off for fine work. With reduced motion there is no easing: inside the window the angle is the mark.
 *
 * Sizes (degrees): a straight mark (0, 90, 180, 270: `STRONG`) is felt from 7 away, a diagonal (`WEAK`) from 3.5.
 * Seven is as wide as a mark can be without a slow turn feeling sticky (at the 0.45 degrees a pixel the views turn
 * by, 7 degrees is 16 pixels of hand travel: a deliberate approach, not an accident), and half of that for the marks
 * one meets on the way to the straight ones, so that they are found when looked for and passed when not.
 */

/** Half-width of the window of a straight mark and of a diagonal one, degrees. */
export const STRONG = 7;
export const WEAK = 3.5;
/** The inner share of a window in which the angle is exactly the mark. */
export const HOLD = 0.45;
/** Leaving takes this much more than entering. */
export const HYSTERESIS = 1.35;

export interface Mark {
  at: number;
  /** Half-width of its window, degrees. */
  pull: number;
}
/** What a drag remembers between two moves: the mark the angle is caught on, if any. */
export interface MagnetState {
  on: Mark | null;
  /** The mark the drag began on: it does not hold the hand back; it catches again once the hand has been away from it. */
  free?: Mark | null;
}
/** The memory of a drag that begins at `angle`: a drag that begins on a mark leaves it freely. */
export function magnetStart(angle: number, marks: readonly Mark[], period?: number): MagnetState {
  let free: Mark | null = null, bd = Infinity;
  for (const m of marks) {
    const d = Math.abs(away(angle, m.at, period));
    if (d <= m.pull && d < bd) {
      free = m;
      bd = d;
    }
  }
  return { on: null, free };
}
export interface MagnetOptions {
  /** The angle wraps round (360 for a full turn): marks are met from both sides of the wrap. */
  period?: number;
  /** The magnet is off (Alt held): the angle is the hand's. */
  off?: boolean;
  /** No easing: inside a window the angle is the mark, outside it is the hand's. */
  reduced?: boolean;
}

/** Marks every 90 degrees (strong) and on the diagonals between (weak), over a full turn or within [min, max]. */
export function quarterMarks(min = 0, max = 359.999, weak = true): Mark[] {
  const out: Mark[] = [];
  for (let a = Math.ceil(min / 45) * 45; a <= max + 1e-9; a += 45) {
    if (a % 90 === 0) out.push({ at: a, pull: STRONG });
    else if (weak) out.push({ at: a, pull: WEAK });
  }
  return out;
}

/** The signed distance from `mark` to `angle`, the short way round when the angle wraps. */
function away(angle: number, mark: number, period?: number): number {
  let d = angle - mark;
  if (period) d -= Math.round(d / period) * period;
  return d;
}

/**
 * The angle to show for the hand's `raw` angle. `state` is the drag's memory (start each drag with `{ on: null }`).
 * The result is continuous in `raw` except for the small tug on entering a window.
 */
export function magnet(raw: number, marks: readonly Mark[], state: MagnetState, o: MagnetOptions = {}): number {
  if (state.free && Math.abs(away(raw, state.free.at, o.period)) > state.free.pull * HYSTERESIS) state.free = null;
  if (o.off) {
    state.on = null;
    return raw;
  }
  // held: stays held until the hand is past the wider edge
  if (state.on && Math.abs(away(raw, state.on.at, o.period)) > state.on.pull * HYSTERESIS) state.on = null;
  if (!state.on) {
    // the nearest mark whose window the hand is in
    let best: Mark | null = null, bd = Infinity;
    for (const m of marks) {
      if (m === state.free) continue;
      const d = Math.abs(away(raw, m.at, o.period));
      if (d <= m.pull && d < bd) {
        best = m;
        bd = d;
      }
    }
    state.on = best;
  }
  const m = state.on;
  if (!m) return raw;
  if (o.reduced) return near(raw, m.at, o.period);
  return magnetAt(raw, m, o.period);
}
/** The mark as the turn nearest to `raw` (an angle that wraps is not sent the long way round). */
const near = (raw: number, mark: number, period?: number): number => (period ? mark + Math.round((raw - mark) / period) * period : mark);

/** The angle to keep when the hand lets go: the mark itself when it let go inside a mark's window. */
export function magnetRelease(raw: number, state: MagnetState, o: MagnetOptions = {}): number {
  const m = state.on;
  state.on = null;
  if (o.off || !m) return raw;
  if (Math.abs(away(raw, m.at, o.period)) > m.pull + 1e-9) return magnetAt(raw, m, o.period);
  return near(raw, m.at, o.period);
}
/** What is shown for a hand at `raw` held by `m`: the mark in the inner part of its window, easing out to the hand's angle at the wider edge. */
function magnetAt(raw: number, m: Mark, period?: number): number {
  const d = away(raw, m.at, period);
  const hold = m.pull * HOLD, edge = m.pull * HYSTERESIS;
  if (Math.abs(d) <= hold + 1e-9) return near(raw, m.at, period);
  if (Math.abs(d) >= edge) return raw;
  // between the held part and the edge the angle eases from the mark out to the hand's own angle
  return near(raw, m.at, period) + Math.sign(d) * ((Math.abs(d) - hold) / (edge - hold)) * edge;
}

/** A keyboard step: the next multiple of `step` in the direction of `dir` (so steps land on the marks, never beside them). */
export function stepAngle(value: number, dir: 1 | -1, step: number): number {
  const k = value / step;
  const next = dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1;
  return next * step;
}
