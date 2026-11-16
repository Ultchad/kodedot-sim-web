/** Detents of the phone's bottom sheet (portrait). Pure, so the snapping is unit-tested. */
export type Detent = 'peek' | 'half' | 'full';
/** Height of the closed bar: grip (20) + tab row (44) + padding (8). The tabs stay visible and usable in it. */
export const PEEK_PX = 72;

export function detentHeights(vh: number): Record<Detent, number> {
  return { peek: PEEK_PX, half: Math.max(300, Math.round(vh * 0.5)), full: Math.max(320, vh - 16) };
}

/** Nearest detent to a dragged height; a quick flick (px/ms, negative = upwards) goes one step further in its direction. */
export function snapDetent(h: number, vh: number, velocity = 0): Detent {
  const d = detentHeights(vh);
  const order: Detent[] = ['peek', 'half', 'full'];
  let best: Detent = 'peek';
  for (const k of order) if (Math.abs(d[k] - h) < Math.abs(d[best] - h)) best = k;
  if (Math.abs(velocity) > 0.5) {
    const up = velocity < 0;
    const agrees = up ? d[best] >= h : d[best] <= h;
    if (!agrees) best = order[Math.min(2, Math.max(0, order.indexOf(best) + (up ? 1 : -1)))];
  }
  return best;
}
