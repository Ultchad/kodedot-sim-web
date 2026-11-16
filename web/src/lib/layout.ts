import { useEffect, useState } from 'react';

export type LayoutMode = 'wide' | 'tablet' | 'phone-portrait' | 'phone-landscape';

/** Pure classification so it can be unit tested. */
export function classifyLayout(w: number, h: number): LayoutMode {
  if (h <= 500 && w > h) return 'phone-landscape';
  if (w < 640) return 'phone-portrait';
  if (w < 1180) return 'tablet';
  return 'wide';
}

export function useLayoutMode(): LayoutMode {
  const read = () => classifyLayout(window.innerWidth, window.innerHeight);
  const [mode, setMode] = useState<LayoutMode>(read);
  useEffect(() => {
    const on = () => setMode(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return mode;
}

/** Live viewport size (CSS px). */
export function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
    };
  }, []);
  return vp;
}

// ---------------------------------------------------------------- side panels
//
// The two side cards (bench on the left, console on the right) adapt in steps that never hide the device:
//   width >= 1180  both are docked columns
//   width >=  960  the bench is docked, the console is a drawer over the stage
//   otherwise      both are drawers
// Docked cards can be collapsed and resized; their widths are clamped so the stage keeps STAGE_MIN px.

export type PanelId = 'bench' | 'console';
export type PanelPlacement = 'dock' | 'drawer';

export const BENCH_DOCK_MIN_VW = 960;
export const CONSOLE_DOCK_MIN_VW = 1180;
export const STAGE_MIN = 400;
/** Gaps and page padding around the three columns (12 px each: left, right, two gutters). */
export const SHELL_GAPS = 48;
export const PANEL_LIMITS: Record<PanelId, { min: number; max: number; share: number }> = {
  bench: { min: 304, max: 480, share: 0.22 },
  console: { min: 320, max: 720, share: 0.27 },
};
/** Default width without a saved preference: a share of the viewport, so wide screens give the cards more room. */
const DEFAULT_MAX: Record<PanelId, number> = { bench: 416, console: 544 };

export function planPanels(w: number): Record<PanelId, PanelPlacement> {
  return { bench: w >= BENCH_DOCK_MIN_VW ? 'dock' : 'drawer', console: w >= CONSOLE_DOCK_MIN_VW ? 'dock' : 'drawer' };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Widths (px) of the docked cards. `saved` holds the widths the user dragged to (or null), `docked` says which cards
 * take a column right now. The console gives way first, then the bench, never below their minimum.
 */
export function panelWidths(vw: number, saved: Record<PanelId, number | null>, docked: Record<PanelId, boolean>): Record<PanelId, number> {
  const want = (id: PanelId) => {
    const lim = PANEL_LIMITS[id];
    return Math.round(clamp(saved[id] ?? Math.min(DEFAULT_MAX[id], vw * lim.share), lim.min, lim.max));
  };
  let bench = docked.bench ? want('bench') : 0;
  let cons = docked.console ? want('console') : 0;
  const over = () => bench + cons + STAGE_MIN + SHELL_GAPS - vw;
  if (over() > 0 && cons) cons = Math.max(PANEL_LIMITS.console.min, cons - over());
  if (over() > 0 && bench) bench = Math.max(PANEL_LIMITS.bench.min, bench - over());
  return { bench, console: cons };
}

export const isPhone = (m: LayoutMode) => m === 'phone-portrait' || m === 'phone-landscape';
