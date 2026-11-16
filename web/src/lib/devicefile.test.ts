import { describe, expect, it } from 'vitest';
import { packRegions, unpackRegions } from './devicefile';

describe('device file', () => {
  it('round-trips regions', () => {
    const m = new Map([['nvs', new Uint8Array([1, 2, 3])], ['keep', new Uint8Array([])], ['flash', new Uint8Array([9, 10])]]);
    const back = unpackRegions(packRegions(m));
    expect([...back.keys()]).toEqual(['nvs', 'keep', 'flash']);
    expect([...back.get('nvs')!]).toEqual([1, 2, 3]);
    expect(back.get('keep')!.byteLength).toBe(0);
    expect([...back.get('flash')!]).toEqual([9, 10]);
  });
  it('rejects foreign and truncated files', () => {
    expect(() => unpackRegions(new Uint8Array([1, 2, 3]))).toThrow(/not a dotbench device file/);
    const p = packRegions(new Map([['a', new Uint8Array(10)]]));
    expect(() => unpackRegions(p.subarray(0, p.byteLength - 3))).toThrow(/truncated/);
  });
});
