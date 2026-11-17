/**
 * Kode multi-radio ("hacking") module (KDFCK001), SHAPE ONLY: the object, with no behaviour, no lamp, nothing that
 * answers.
 *
 * Sources: parts/kode-hacking-shape/manifest.json (body 47 x 35 x 95 mm with the whips; the housing's side profile;
 * the 20 terminals of the interposer's 2x10 and its seat; the antenna reference points SMA1 and SMA2 with their
 * lengths: all measured from the pictures, `body.estimate`) and the owner's reference pictures ref-4, ref-6 (alone)
 * and ref-5 (on the Dot): the same moulding as the Mesh module's. case.ts says what the pictures add.
 * In the soft black of the Dot's own buttons. The maker's moulded name is not reproduced.
 */
import manifest from '../../../../../parts/kode-hacking-shape/manifest.json';
import { defineModel, footprintOf, terminalsFromManifest, type PartState } from '../../index';
import { buildCasedModule } from './case';
import { asManifest } from './shared';

const M = asManifest(manifest);

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode multi-radio module (shape only)',
  footprintMm: footprintOf(M.body),
  build(ctx) {
    return buildCasedModule(M, { shell: ['matte', '#38383b'] }, ctx);
  },
  terminals: terminalsFromManifest(M),
});
