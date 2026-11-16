import type { Material, Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { ButtonId } from '../device/types';

/**
 * Optional drop-in model. If /device/model.glb exists and has every required
 * node (see public/device/MODEL.md) the viewer uses it instead of the
 * procedural body. Anything else (no file, SPA fallback HTML, a node missing)
 * returns null and the procedural body is used.
 *
 * Conventions (documented for the owner in MODEL.md): millimetres, origin at
 * the body centre, +X right, +Y up, +Z towards the viewer; the "screen" mesh is
 * UV-mapped the glTF way (0,0 = top-left of the picture).
 */
export const GLB_URL = '/device/model.glb';
export const GLB_REQUIRED_NODES = ['screen', 'btn_top', 'btn_bottom', 'dpad_up', 'dpad_down', 'dpad_left', 'dpad_right', 'led'] as const;

export interface GlbModel {
  root: Object3D;
  /** the node named "screen" (may be a group) and the mesh inside it that shows the picture */
  screenNode: Object3D;
  screen: Mesh;
  press: Record<ButtonId, Object3D>;
  ledMaterials: MeshStandardMaterial[];
}

export async function loadGlbModel(url = GLB_URL): Promise<GlbModel | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== 'glTF') return null; // e.g. index.html from a SPA fallback
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(buf, '');
    const find = (n: string) => gltf.scene.getObjectByName(n) ?? null;
    const missing = GLB_REQUIRED_NODES.filter((n) => !find(n));
    if (missing.length) {
      console.warn(`[dotbench] ${url}: missing nodes ${missing.join(', ')}; using the procedural model`);
      return null;
    }
    let screen: Mesh | null = null;
    find('screen')!.traverse((o) => {
      if (!screen && (o as Mesh).isMesh) screen = o as Mesh;
    });
    if (!screen) {
      console.warn(`[dotbench] ${url}: node "screen" has no mesh; using the procedural model`);
      return null;
    }
    const ledMaterials: MeshStandardMaterial[] = [];
    find('led')!.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as Material & MeshStandardMaterial;
      mesh.material = m;
      if (m.color) ledMaterials.push(m); // colour (and emissive, when the material has one) follow the live LED
    });
    return {
      root: gltf.scene,
      screenNode: find('screen')!,
      screen,
      press: {
        top: find('btn_top')!,
        bottom: find('btn_bottom')!,
        up: find('dpad_up')!,
        down: find('dpad_down')!,
        left: find('dpad_left')!,
        right: find('dpad_right')!,
      },
      ledMaterials,
    };
  } catch (e) {
    console.warn('[dotbench] could not load the optional model:', e);
    return null;
  }
}
