import { describe, expect, it } from 'vitest';
import { isGlb, toGlb } from './container';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

function readGlb(glb: ArrayBuffer) {
  const dv = new DataView(glb);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLen)));
  const binAt = 20 + jsonLen;
  const bin = binAt < glb.byteLength ? new Uint8Array(glb, binAt + 8, dv.getUint32(binAt, true)) : new Uint8Array(0);
  return { total: dv.getUint32(8, true), jsonLen, json, bin, binType: binAt < glb.byteLength ? dv.getUint32(binAt + 4, true) : 0 };
}

describe('toGlb', () => {
  it('passes a .glb through untouched', () => {
    const glb = new ArrayBuffer(20);
    new DataView(glb).setUint32(0, 0x46546c67, true);
    expect(isGlb(glb)).toBe(true);
    expect(toGlb(glb)).toBe(glb);
  });

  it('repacks an embedded .gltf: buffers joined, views moved, pictures as buffer views', () => {
    const a = new Uint8Array([1, 2, 3, 4, 5]); // 5 bytes: the next buffer starts on a 4-byte boundary
    const b = new Uint8Array([9, 8, 7]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    const gltf = {
      asset: { version: '2.0' },
      buffers: [
        { uri: `data:application/octet-stream;base64,${b64(a)}`, byteLength: 5 },
        { uri: `data:application/gltf-buffer;base64,${b64(b)}`, byteLength: 3 },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 1, byteLength: 4 },
        { buffer: 1, byteLength: 3 },
      ],
      images: [{ uri: `data:image/png;base64,${b64(png)}` }],
      meshes: [{}],
    };
    const glb = toGlb(enc(JSON.stringify(gltf)));
    expect(isGlb(glb)).toBe(true);
    const r = readGlb(glb);
    expect(r.total).toBe(glb.byteLength);
    expect(r.jsonLen % 4).toBe(0);
    expect(r.binType).toBe(0x004e4942);
    expect(r.json.buffers).toEqual([{ byteLength: r.bin.byteLength }]);
    expect(r.json.bufferViews[0]).toEqual({ buffer: 0, byteOffset: 1, byteLength: 4 });
    expect(r.json.bufferViews[1]).toEqual({ buffer: 0, byteOffset: 8, byteLength: 3 });
    expect([...r.bin.subarray(0, 5)]).toEqual([...a]);
    expect([...r.bin.subarray(8, 11)]).toEqual([...b]);
    const img = r.json.images[0];
    expect(img.uri).toBeUndefined();
    expect(img.mimeType).toBe('image/png');
    const view = r.json.bufferViews[img.bufferView];
    expect([...r.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength)]).toEqual([...png]);
  });

  it('says which separate files a .gltf needs', () => {
    const gltf = { asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin', byteLength: 4 }], images: [{ uri: 'textures/skin.png' }] };
    expect(() => toGlb(enc(JSON.stringify(gltf)))).toThrow(/separate files \(scene\.bin, skin\.png\).*single \.glb/);
  });

  it('refuses other things with a readable reason', () => {
    expect(() => toGlb(enc('<!doctype html>'))).toThrow(/neither a \.glb nor a \.gltf/);
    expect(() => toGlb(enc('{"hello":1}'))).toThrow(/neither a \.glb nor a \.gltf/);
    expect(() => toGlb(enc('{"asset":{"version":"1.0"}}'))).toThrow(/version 1\.0/);
  });
});
