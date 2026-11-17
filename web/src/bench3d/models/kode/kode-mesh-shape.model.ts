/**
 * Kode Mesh module (KDMSH001), SHAPE ONLY: the object, with no behaviour, no lamp, nothing that answers.
 *
 * Sources: parts/kode-mesh-shape/manifest.json (footprint about 50 x 24 x 91 mm with the antennas, an ESTIMATE; the
 * 20 terminals of the interposer's 2x10; the connector's seat; the two antenna reference points SMA1 and SMA2 with
 * their lengths) and the owner's reference pictures ref-4, ref-7 (alone) and ref-8 (on the Dot) for the moulding:
 * case.ts says what they show and how it is hung on the manifest. The warm off-white of the Dot's own shell.
 * The recess where the maker moulds its name is left blank; nothing is printed on the module.
 */
import manifest from '../../../../../parts/kode-mesh-shape/manifest.json';
import { PAL, defineModel, footprintOf, terminalsFromManifest, type PartState } from '../../index';
import { buildCasedModule } from './case';
import { asManifest } from './shared';

const M = asManifest(manifest);

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Mesh module (shape only)',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    return buildCasedModule(M, { shell: PAL.plasticCream, seam: '#b3ac9e', mark: 'rgba(120,110,95,0.42)', markShadow: 'rgba(70,62,52,0.55)', markLight: 'rgba(255,253,248,0.85)' }, ctx);
  },
  terminals: terminalsFromManifest(M),
});
