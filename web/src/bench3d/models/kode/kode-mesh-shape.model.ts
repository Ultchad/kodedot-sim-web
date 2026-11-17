/**
 * Kode Mesh module (KDMSH001 rev 1.0), SHAPE ONLY: the object, with no behaviour, no lamp, nothing that answers.
 *
 * Sources: parts/kode-mesh-shape/manifest.json (footprint 41.9 x 44.7 x 20 mm: the documented board, the height a
 * guess; the 17 mount terminals), the written spec research/06-official-modules-spec.md section 5 (a two-part case,
 * two SMA ports: J501 sub-GHz 863 to 928 MHz and J502 2.4 GHz, a GNSS receiver with a chip antenna inside, the
 * passive 2.54 mm interposer to the Dot) and the maker's store picture for the look (an L-shaped shell in the Dot's
 * cream plastic, gold jacks, the pin row under the cap). case.ts says how it lies and what is left out (the whips).
 * Which jack is which band, and where the GNSS antenna sits inside, are guesses. No maker's logo or wordmark.
 */
import manifest from '../../../../../parts/kode-mesh-shape/manifest.json';
import { FONT_MONO, PAL, defineModel, footprintOf, rr, terminalsFromManifest, text, type PartState } from '../../index';
import { buildCasedModule } from './case';
import { asManifest } from './shared';

const M = asManifest(manifest);

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Mesh module (shape only)',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    return buildCasedModule(
      M,
      {
        shell: PAL.plasticCream,
        seam: '#b9b2a4',
        ink: 'rgba(118,108,92,0.62)',
        inkEdge: 'rgba(255,253,247,0.7)',
        name: 'MESH',
        code: 'KDMSH001',
        jacks: [{ x: -4.5, label: '2.4 GHz' }, { x: 11.5, label: '868 MHz' }],
        face(g, w, d) {
          // where the GNSS chip antenna lies under the lid: keep-clear mark and its name
          g.strokeStyle = 'rgba(118,108,92,0.5)';
          g.lineWidth = 0.2;
          g.setLineDash([0.9, 0.7]);
          rr(g, w / 2 - 15.4, -d / 2 + 3.6, 10.4, 6.4, 1);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = 'rgba(118,108,92,0.62)';
          text(g, 'GNSS', w / 2 - 10.2, -d / 2 + 6.8, 1.3, { font: FONT_MONO, weight: 700 });
        },
      },
      ctx,
    );
  },
  terminals: terminalsFromManifest(M),
});
