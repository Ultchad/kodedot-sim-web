/**
 * Kode multi-radio ("hacking") module (KDFCK001 rev 1.0), SHAPE ONLY: the object, with no behaviour, no lamp,
 * nothing that answers.
 *
 * Sources: parts/kode-hacking-shape/manifest.json (footprint 42 x 45 x 20 mm, an ESTIMATE; the 17 mount terminals),
 * the written spec research/06-official-modules-spec.md section 6 (the same two-part case as the Mesh module; two SMA
 * ports: J701 for the 2.4 GHz radio and J501 for the dual-band Wi-Fi radio; the sub-GHz radio has a printed antenna
 * inside and no connector; a GNSS receiver; the passive 2.54 mm interposer to the Dot) and the maker's store picture
 * for the look (the L-shaped shell in black, gold jacks, the pin row under the cap). case.ts says how it lies and
 * what is left out (the whips). Which jack is which radio, and where the antennas sit inside, are guesses.
 * No maker's logo or wordmark, and the print is the neutral part code rather than the product's name.
 */
import manifest from '../../../../../parts/kode-hacking-shape/manifest.json';
import { FONT_MONO, defineModel, footprintOf, rr, terminalsFromManifest, text, type PartState } from '../../index';
import { buildCasedModule } from './case';
import { asManifest } from './shared';

const M = asManifest(manifest);
const INK = 'rgba(168,168,176,0.6)';

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode multi-radio module (shape only)',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    return buildCasedModule(
      M,
      {
        shell: ['matte', '#2b2b2f'],
        seam: '#0d0d0e',
        ink: INK,
        inkEdge: 'rgba(0,0,0,0.7)',
        name: 'RADIO',
        code: 'KDFCK001',
        jacks: [{ x: -4.5, label: '2.4 GHz' }, { x: 11.5, label: 'Wi-Fi' }],
        face(g, w, d) {
          // where the printed sub-GHz antenna and the GNSS chip antenna lie under the lid: keep-clear marks
          g.strokeStyle = 'rgba(168,168,176,0.5)';
          g.lineWidth = 0.2;
          g.setLineDash([0.9, 0.7]);
          rr(g, -w / 2 + 5, -d / 2 + 3.6, 15, 6.4, 1);
          g.stroke();
          rr(g, w / 2 - 15.4, -d / 2 + 3.6, 10.4, 6.4, 1);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = INK;
          text(g, 'SUB-GHz', -w / 2 + 12.5, -d / 2 + 6.8, 1.3, { font: FONT_MONO, weight: 700 });
          text(g, 'GNSS', w / 2 - 10.2, -d / 2 + 6.8, 1.3, { font: FONT_MONO, weight: 700 });
        },
      },
      ctx,
    );
  },
  terminals: terminalsFromManifest(M),
});
