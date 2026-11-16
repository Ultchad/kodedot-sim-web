import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Observable } from '../device/types';

export function useObservable<T>(o: Observable<T>): T {
  return useSyncExternalStore(o.subscribe, o.get);
}

/** Re-renders at a fixed interval (clocks, fps readouts). */
export function useTick(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}
