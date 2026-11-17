/**
 * The table: a warm wooden top with a light desk mat on it. The mat carries a quiet dot grid (the snapping grid), a
 * stitched border and a ruler along its front edge, all drawn once into one texture.
 */
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, type Texture } from 'three';
import { roundedRectLoop } from '../lib/bodyModel';
import { Shape } from '../bench3d/shape';
import { DESK, GRID_DOTS, MAT } from './layout';

export const MAT_THICK = 2.2;
/** Texture pixels per millimetre of mat. */
const PPM = 3;

export interface TableColours {
  mat: string;
  ink: string;
  wood: string;
  woodDark: string;
}
export const TABLE_LIGHT: TableColours = { mat: '#ebe5da', ink: '#5b5247', wood: '#d2a777', woodDark: '#b98a59' };
export const TABLE_DARK: TableColours = { mat: '#4a4640', ink: '#d8d0c4', wood: '#6b513a', woodDark: '#54402e' };

function matTexture(c: TableColours): CanvasTexture {
  const w = MAT.x1 - MAT.x0, d = MAT.z1 - MAT.z0;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * PPM);
  cv.height = Math.round(d * PPM);
  const g = cv.getContext('2d')!;
  g.fillStyle = c.mat;
  g.fillRect(0, 0, cv.width, cv.height);
  // a very faint weave, so the mat is not a flat fill
  g.globalAlpha = 0.035;
  g.fillStyle = c.ink;
  for (let y = 0; y < cv.height; y += 4) g.fillRect(0, y, cv.width, 1);
  for (let x = 0; x < cv.width; x += 4) g.fillRect(x, 0, 1, cv.height);
  // the grid: a dot every 10 mm, a small cross every 50 mm; the Dot lies at the origin
  const px = (x: number) => (x - MAT.x0) * PPM;
  const pz = (z: number) => (z - MAT.z0) * PPM;
  g.globalAlpha = 1;
  for (let x = Math.ceil((MAT.x0 + 12) / GRID_DOTS) * GRID_DOTS; x <= MAT.x1 - 12; x += GRID_DOTS) {
    for (let z = Math.ceil((MAT.z0 + 12) / GRID_DOTS) * GRID_DOTS; z <= MAT.z1 - 12; z += GRID_DOTS) {
      const major = x % 50 === 0 && z % 50 === 0;
      g.globalAlpha = major ? 0.42 : 0.2;
      if (major) {
        g.fillRect(px(x) - 5, pz(z) - 0.75, 10, 1.5);
        g.fillRect(px(x) - 0.75, pz(z) - 5, 1.5, 10);
      } else {
        g.beginPath();
        g.arc(px(x), pz(z), 1.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // stitched border
  g.globalAlpha = 0.34;
  g.strokeStyle = c.ink;
  g.lineWidth = 1.6;
  g.setLineDash([9, 6]);
  g.beginPath();
  g.roundRect(6 * PPM, 6 * PPM, cv.width - 12 * PPM, cv.height - 12 * PPM, (MAT.r - 6) * PPM);
  g.stroke();
  g.setLineDash([]);
  // ruler along the front edge: a tick every 10 mm, a number every 50
  g.globalAlpha = 0.5;
  g.font = `600 ${3.4 * PPM}px "DM Sans", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const base = cv.height - 9.5 * PPM;
  for (let x = Math.ceil((MAT.x0 + 30) / 10) * 10; x <= MAT.x1 - 30; x += 10) {
    const big = x % 50 === 0;
    g.fillRect(px(x) - 0.6, base - (big ? 3.2 : 1.8) * PPM, 1.2, (big ? 3.2 : 1.8) * PPM);
    if (big) g.fillText(String(Math.abs(x)), px(x), base - 4.4 * PPM);
  }
  g.globalAlpha = 1;
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function woodTexture(c: TableColours): CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const g = cv.getContext('2d')!;
  g.fillStyle = c.wood;
  g.fillRect(0, 0, cv.width, cv.height);
  // long, soft grain lines (a fixed sequence: the table looks the same on every visit)
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.strokeStyle = c.woodDark;
  for (let i = 0; i < 170; i++) {
    const y = rnd() * cv.height;
    g.globalAlpha = 0.05 + rnd() * 0.12;
    g.lineWidth = 0.6 + rnd() * 2.2;
    g.beginPath();
    g.moveTo(0, y);
    const k = (rnd() - 0.5) * 16;
    g.bezierCurveTo(cv.width * 0.3, y + k, cv.width * 0.7, y - k, cv.width, y + (rnd() - 0.5) * 6);
    g.stroke();
  }
  g.globalAlpha = 1;
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Soft shadow of the whole table on the page behind it. */
function floorShadow(): CanvasTexture {
  const s = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d')!;
  const OFF = s * 3;
  g.shadowColor = 'rgba(70, 48, 28, 1)';
  g.shadowBlur = s * 0.1;
  g.shadowOffsetX = OFF;
  g.beginPath();
  g.roundRect(s * 0.16 - OFF, s * 0.16, s * 0.68, s * 0.68, s * 0.07);
  g.fill();
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export interface Table {
  group: Group;
  setColours(c: TableColours): void;
  dispose(): void;
}

export function buildTable(colours: TableColours): Table {
  const group = new Group();
  group.name = 'table';
  const textures: Texture[] = [];

  // the wooden top: one prism with a generous bevel; planar UVs over its top
  const desk = new Shape();
  desk.prism('matte', '#ffffff', roundedRectLoop((DESK.x0 + DESK.x1) / 2, (DESK.z0 + DESK.z1) / 2, DESK.x1 - DESK.x0, DESK.z1 - DESK.z0, DESK.r, 10), -MAT_THICK - DESK.thick, -MAT_THICK, 3);
  const deskGeo = desk.build().matte!;
  planarUv(deskGeo, DESK.x0, DESK.x1, DESK.z0, DESK.z1);
  const deskMat = new MeshStandardMaterial({ roughness: 0.62, metalness: 0, vertexColors: true });
  const deskMesh = new Mesh(deskGeo, deskMat);
  deskMesh.name = 'desk';

  const mat = new Shape();
  mat.prism('matte', '#ffffff', roundedRectLoop((MAT.x0 + MAT.x1) / 2, (MAT.z0 + MAT.z1) / 2, MAT.x1 - MAT.x0, MAT.z1 - MAT.z0, MAT.r, 8), -MAT_THICK, 0, 0.9);
  const matGeo = mat.build().matte!;
  planarUv(matGeo, MAT.x0, MAT.x1, MAT.z0, MAT.z1);
  const matMat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, vertexColors: true });
  const matMesh = new Mesh(matGeo, matMat);
  matMesh.name = 'mat';

  const shadowMat = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0.55 });
  const shadow = new Mesh(new PlaneGeometry(1, 1), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set((DESK.x0 + DESK.x1) / 2, -MAT_THICK - DESK.thick - 60, (DESK.z0 + DESK.z1) / 2 + 30);
  shadow.scale.set((DESK.x1 - DESK.x0) * 1.5, (DESK.z1 - DESK.z0) * 1.5, 1);
  shadow.renderOrder = -2;
  const st = floorShadow();
  shadowMat.map = st;

  group.add(shadow, deskMesh, matMesh);
  for (const m of group.children) (m as Mesh).raycast = () => {};

  const setColours = (c: TableColours) => {
    for (const t of textures.splice(0)) t.dispose();
    const mt = matTexture(c), wt = woodTexture(c);
    textures.push(mt, wt);
    matMat.map = mt;
    deskMat.map = wt;
    matMat.needsUpdate = deskMat.needsUpdate = true;
  };
  setColours(colours);

  return {
    group,
    setColours,
    dispose() {
      for (const t of textures) t.dispose();
      st.dispose();
      deskGeo.dispose();
      matGeo.dispose();
      shadow.geometry.dispose();
      deskMat.dispose();
      matMat.dispose();
      shadowMat.dispose();
    },
  };
}

/** UVs from the footprint position: u along X, v from the far edge (top of the texture) to the near edge. */
function planarUv(g: import('three').BufferGeometry, x0: number, x1: number, z0: number, z1: number): void {
  const p = g.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = (p.getX(i) - x0) / (x1 - x0);
    uv[i * 2 + 1] = 1 - (p.getZ(i) - z0) / (z1 - z0);
  }
  g.setAttribute('uv', new (g.getAttribute('position').constructor as typeof import('three').BufferAttribute)(uv, 2));
}
