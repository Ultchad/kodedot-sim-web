/**
 * Print on a surface: pin labels, legends, the live picture on the glass. Such a mesh lies exactly on (or within a
 * hair of) the surface under it, so the depth buffer cannot tell which of the two is in front: the print flickers,
 * shows a moire or vanishes, differently at every angle (depth fighting).
 *
 * The cure used here does not depend on the angle, the zoom or the depth buffer's precision: in the vertex shader
 * the print is pulled towards the camera along its own line of sight by a fixed distance in millimetres. Its place
 * on the screen does not change at all (every point moves along the ray it is seen through); only its depth does,
 * by the same amount everywhere, which is far more than the buffer's resolution (see the near and far planes kept
 * tight around the model in Device3D) and more than the surface under it can be off after simplification.
 * A constant polygon offset is added for good measure; it alone would not be enough, because it is measured in
 * units of the depth buffer and not in millimetres.
 */
import type { Material } from 'three';

/** How far printed parts of a model file are pulled (mm): more than the simplification error of the surface under them. */
export const DECAL_PULL_MM = 0.3;

export function pullTowardsCamera<T extends Material>(material: T, mm: number): T {
  material.userData.pullMm = mm;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.pullMm = { value: mm };
    shader.vertexShader =
      'uniform float pullMm;\n' +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n\tmvPosition.xyz -= normalize( mvPosition.xyz ) * pullMm;\n\tgl_Position = projectionMatrix * mvPosition;',
      );
  };
  material.customProgramCacheKey = () => `pull:${mm}`;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  material.needsUpdate = true;
  return material;
}

/** Marks a material as print on a surface: pulled forward, never writing depth (what is under it already did). */
export function asDecal<T extends Material>(material: T, mm = DECAL_PULL_MM): T {
  pullTowardsCamera(material, mm);
  material.depthWrite = false;
  material.userData.decal = true;
  return material;
}

/**
 * True when all points lie on one plane within `tolerance` (same unit as the points): a flat sheet, whatever way it
 * faces. `positions` is x,y,z triples; `indices` its triangles (or null for a plain triangle list).
 */
export function isFlatSheet(positions: ArrayLike<number>, indices: ArrayLike<number> | null, tolerance = 0.05): boolean {
  const count = positions.length / 3;
  if (count < 3) return false;
  const at = (i: number): [number, number, number] => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const tri = indices ? indices.length / 3 : Math.floor(count / 3);
  // the plane of the largest triangle among the first few (a sliver gives a poor normal)
  let best = 0;
  let n: [number, number, number] = [0, 0, 0];
  let origin: [number, number, number] = [0, 0, 0];
  for (let t = 0; t < Math.min(tri, 64); t++) {
    const a = at(indices ? indices[t * 3] : t * 3), b = at(indices ? indices[t * 3 + 1] : t * 3 + 1), c = at(indices ? indices[t * 3 + 2] : t * 3 + 2);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const x = u[1] * v[2] - u[2] * v[1], y = u[2] * v[0] - u[0] * v[2], z = u[0] * v[1] - u[1] * v[0];
    const len = Math.hypot(x, y, z);
    if (len > best) {
      best = len;
      n = [x / len, y / len, z / len];
      origin = a;
    }
  }
  if (best === 0) return false;
  for (let i = 0; i < count; i++) {
    const p = at(i);
    if (Math.abs((p[0] - origin[0]) * n[0] + (p[1] - origin[1]) * n[1] + (p[2] - origin[2]) * n[2]) > tolerance) return false;
  }
  return true;
}
