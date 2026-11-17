/**
 * A body for a part that has no Bench3D model (yet, or ever: a part the user imported): made from its manifest alone.
 * A board of the part's footprint and height, the part's own picture as its top face, a gold pin at every terminal.
 */
import { CanvasTexture, Mesh, MeshStandardMaterial, SRGBColorSpace } from 'three';
import { asDecal } from '../device3d/decal';
import { defineModel, fromManifestMm, footprintOf, terminalsFromManifest, PAL, Shape, quadGeometry, topQuad, type PartModel, type PartState } from '../bench3d/index';
import type { PartManifest } from './service';

export function fallbackModel(m: PartManifest, pictureUrl?: string): PartModel<PartState> {
  const terminals = terminalsFromManifest(m);
  return defineModel<PartState>({
    id: m.id,
    title: m.name.en,
    footprintMm: footprintOf(m.body),
    budget: 40000,
    terminals,
    build() {
      const { w_mm: w, d_mm: d, h_mm: h } = m.body;
      const s = new Shape();
      const top = Math.max(1.2, h);
      s.box(...PAL.plasticGraphite, 0, 0, w, d, 0, top, Math.min(2, w / 6, d / 6), Math.min(0.5, top / 3), { ao: 0.85 });
      // a pin where each terminal is: on top a socket's mouth, underneath a leg, on a side a contact
      for (const p of m.pins.slice(0, 900)) {
        if (!p.mm || p.kind === 'nc') continue;
        const [x, y, z] = fromManifestMm(m.body, p.mm, p.face);
        if (p.face === 'top' || !p.face) s.rect(...PAL.gold, x, z, 0.9, 0.9, Math.max(top, y) + 0.03);
        else if (p.face !== 'bottom') s.box(...PAL.gold, x, z, 1, 1, Math.max(0.2, y - 0.5), y + 0.5, 0.1, 0.1, { cap: true });
      }
      const root = s.toObject();
      if (pictureUrl && typeof document !== 'undefined') {
        // the part's picture is its top view at a known scale: it lies on the board as print
        const mat = asDecal(new MeshStandardMaterial({ transparent: true, roughness: 0.6 }), 0.2);
        const mesh = new Mesh(quadGeometry(topQuad(0, 0, top + 0.02, w / 2, d / 2)), mat);
        mesh.userData.bench3d = 'static';
        mesh.renderOrder = 2;
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          const k = Math.min(1024 / w, 1024 / d, 12);
          c.width = Math.max(2, Math.round(w * k));
          c.height = Math.max(2, Math.round(d * k));
          c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
          const t = new CanvasTexture(c);
          t.colorSpace = SRGBColorSpace;
          t.anisotropy = 4;
          mat.map = t;
          mat.needsUpdate = true;
          onPictureReady.forEach((l) => l());
        };
        img.src = pictureUrl;
        root.add(mesh);
      }
      return root;
    },
  });
}
/** Called when a part's picture has arrived and been drawn (an on-demand renderer draws a frame). */
export const onPictureReady = new Set<() => void>();
