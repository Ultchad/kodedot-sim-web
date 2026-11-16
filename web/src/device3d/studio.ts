/**
 * The light: a small photo studio rendered once into a prefiltered environment
 * map. Everything in the scene is lit by it (diffuse and reflections), which is
 * what gives the fillets and facets their soft, readable gradients; there are
 * no shadow maps and no post-processing.
 *
 * Layout, seen from the camera (which looks along -Z, slightly from above):
 *   key    large softbox, upper right, in front (the side the light guide is on)
 *   fill   wide, weaker panel on the left: the left wall reads a step darker
 *          than the face, which is what makes the depth visible at a glance
 *   front  very large, weak panel behind the camera (keeps the face even)
 *   top    overhead strip (lights the top face, draws the top fillets)
 *   rims   two tall strips behind, left and right (edge light on the walls,
 *          so no wall ever sinks into the page colour)
 *   floor  weak bounce in the page colour from below
 *   sheen  seen by the glossy parts only: a soft panel off to the right
 */
import { BackSide, BoxGeometry, Color, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene, type Texture, type WebGLRenderer } from 'three';

interface Panel {
  pos: [number, number, number];
  size: [number, number];
  colour: string;
  power: number;
  /** false: this panel is hidden from the glossy parts; 'only': it exists for them alone (see makeStudioEnvironment) */
  mirrored?: boolean | 'only';
}

export const STUDIO: { room: string; roomPower: number; panels: Panel[] } = {
  room: '#b4b3b1',
  roomPower: 0.42,
  panels: [
    { pos: [6, 7, 7], size: [7, 7], colour: '#fffaf3', power: 5.8 }, // key
    { pos: [-8.5, 1.5, 4.5], size: [6, 9], colour: '#f4f6ff', power: 1.65 }, // fill
    { pos: [0, 1, 11], size: [16, 12], colour: '#fffdfa', power: 1.2, mirrored: false }, // front
    { pos: [0, 10, -1], size: [9, 5], colour: '#ffffff', power: 3.4 }, // top
    { pos: [-8.5, 2, -6], size: [2.4, 11], colour: '#fff7ec', power: 5.0 }, // rim left
    { pos: [8.5, 2, -6.5], size: [2.4, 11], colour: '#f4f6ff', power: 5.0 }, // rim right
    { pos: [0, -7, 1], size: [18, 18], colour: '#c2bab3', power: 0.6, mirrored: false }, // floor bounce (the page colour)
    { pos: [9, 2, 6.5], size: [5, 9], colour: '#ffffff', power: 1.6, mirrored: 'only' }, // sheen: what the glass shows when the device is turned a little
  ],
};

/**
 * `forGloss`: the version the glass and the side window mirror. It is the same
 * studio with a black flag in front: no front panel, no floor, a nearly black
 * room. Face-on, the glass then mirrors darkness and the picture keeps its
 * blacks; turned, it picks up the softboxes as a soft sheen.
 */
export function makeStudioEnvironment(gl: WebGLRenderer, forGloss = false): { texture: Texture; dispose(): void } {
  const scene = new Scene();
  const disposables: { dispose(): void }[] = [];
  const room = new Mesh(new BoxGeometry(40, 40, 40), new MeshBasicMaterial({ color: new Color(STUDIO.room).multiplyScalar(forGloss ? 0.05 : STUDIO.roomPower), side: BackSide, toneMapped: false }));
  scene.add(room);
  disposables.push(room.geometry, room.material);
  for (const p of STUDIO.panels) {
    if (forGloss ? p.mirrored === false : p.mirrored === 'only') continue;
    const m = new Mesh(new PlaneGeometry(p.size[0], p.size[1]), new MeshBasicMaterial({ color: new Color(p.colour).multiplyScalar(p.power), side: DoubleSide, toneMapped: false }));
    m.position.set(...p.pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
    disposables.push(m.geometry, m.material);
  }
  const pm = new PMREMGenerator(gl);
  const target = pm.fromScene(scene, 0.035, 0.1, 100);
  pm.dispose();
  disposables.forEach((x) => x.dispose());
  return { texture: target.texture, dispose: () => target.dispose() };
}
