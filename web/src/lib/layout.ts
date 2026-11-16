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

export const isPhone = (m: LayoutMode) => m === 'phone-portrait' || m === 'phone-landscape';
