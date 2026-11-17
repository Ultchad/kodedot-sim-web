/**
 * Kode Mesh module (KDMSH001), SHAPE ONLY: the object, with no behaviour, no lamp, nothing that answers.
 *
 * Sources: parts/kode-mesh-shape/manifest.json (the 20 terminals of the interposer's 2x10; its body is an estimate
 * made before the pictures below came) and the owner's reference pictures ref-4, ref-7 (alone) and ref-8 (on the
 * Dot), from which the moulding was measured: case.ts holds the measures and says how the model is hung on the
 * manifest. The warm off-white of the pictures (a shade whiter than the kit's cream). The maker's moulded name is not reproduced.
 */
import manifest from '../../../../../parts/kode-mesh-shape/manifest.json';
import { defineModel, terminalsFromManifest, type PartState } from '../../index';
import { buildCasedModule, casedFootprint } from './case';
import { asManifest } from './shared';

const M = asManifest(manifest);

export default defineModel<PartState>({
  id: M.id,
  title: 'Kode Mesh module (shape only)',
  footprintMm: casedFootprint(M),
  build(ctx) {
    return buildCasedModule(M, { shell: ['matte', '#eeebe5'] }, ctx);
  },
  terminals: terminalsFromManifest(M),
});
