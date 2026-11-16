import { MockDevice } from './mock';
import type { KodeDevice } from './types';
import { WasmDevice } from './wasm';

export type DeviceKind = 'mock' | 'wasm';

export function createDevice(kind: DeviceKind): KodeDevice {
  return kind === 'mock' ? new MockDevice() : new WasmDevice();
}
