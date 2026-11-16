import { useSyncExternalStore } from 'react';
import type { BenchState, BenchStore } from '../bench/store';

export function useBenchState(store: BenchStore): BenchState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
