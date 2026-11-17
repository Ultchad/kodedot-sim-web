/**
 * Kode multi-radio ("hacking") module (KDFCK001), SHAPE ONLY: the object, with no behaviour, no lamp, nothing that
 * answers.
 *
 * Sources: parts/kode-hacking-shape/manifest.json (the 20 terminals of the interposer's 2x10; its body is an
 * estimate made before the pictures below came) and the owner's reference pictures ref-4, ref-6 (alone) and ref-5
 * (on the Dot): the same moulding as the Mesh module's, in soft black. case.ts holds the measures and says how the
 * model is hung on the manifest. The maker's moulded name is not reproduced.
 */
import manifest from '../../../../../parts/kode-hacking-shape/manifest.json';
import { defineModel, terminalsFromManifest, type PartState } from '../../index';
import { buildCasedModule, casedFootprint } from './case';
import { asManifest } from './shared';

const M = asManifest(manifest);

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode multi-radio module (shape only)',
  footprintMm: casedFootprint(M),
  build(ctx) {
    return buildCasedModule(M, { shell: ['matte', '#4d4d51'] }, ctx);
  },
  terminals: terminalsFromManifest(M),
});
