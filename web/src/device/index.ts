import { MockDevice } from './mock';
import type { KodeDevice } from './types';
import { SystemDevice } from './wasm';

export type DeviceKind = 'mock' | 'wasm';

export function createDevice(kind: DeviceKind): KodeDevice {
  return kind === 'mock' ? new MockDevice() : new SystemDevice();
}
