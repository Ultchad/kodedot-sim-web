/**
 * Stand-in for components/Device2D in the model stand only (the real module
 * pulls in the whole page). Keep in step with Device2D.backlightFactor.
 */
export const backlightFactor = (pct: number) => Math.pow(Math.max(0, Math.min(100, pct)) / 100, 0.85);
