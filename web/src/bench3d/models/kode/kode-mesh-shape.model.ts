/**
 * Kode Mesh module (KDMSH001), SHAPE ONLY: the object, with no behaviour, no lamp, nothing that answers.
 *
 * Sources: parts/kode-mesh-shape/manifest.json (body 47 x 35 x 95 mm with the whips; the housing's side profile; the
 * 20 terminals of the interposer's 2x10 and its seat; the antenna reference points SMA1 and SMA2 with their lengths:
 * all measured from the pictures, `body.estimate`) and the owner's reference pictures ref-4, ref-7 (alone) and ref-8
 * (on the Dot) for what a manifest does not hold: case.ts says what. The Dot's own shell colour. The maker's moulded name is
 * not reproduced.
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
    return buildCasedModule(M, { shell: PAL.plasticCream }, ctx);
  },
  terminals: terminalsFromManifest(M),
});
