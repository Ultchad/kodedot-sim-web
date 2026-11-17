/**
 * Kode multi-radio ("hacking") module (KDFCK001), SHAPE ONLY: the object, with no behaviour, no lamp, nothing that
 * answers.
 *
 * Sources: parts/kode-hacking-shape/manifest.json (footprint about 50 x 24 x 91 mm with the antennas, an ESTIMATE;
 * the 20 terminals of the interposer's 2x10; the connector's seat; the two antenna reference points SMA1 and SMA2 with
 * their lengths) and the owner's reference pictures ref-4, ref-6 (alone) and ref-5 (on the Dot) for the moulding:
 * the same as the Mesh module's, in soft black. case.ts says what they show and how it is hung on the manifest.
 * The recess where the maker moulds its name is left blank; nothing is printed on the module.
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
    return buildCasedModule(M, { shell: ['matte', '#29292c'], seam: '#0e0e0f', mark: 'rgba(0,0,0,0.5)', markShadow: 'rgba(0,0,0,0.75)', markLight: 'rgba(255,255,255,0.14)' }, ctx);
  },
  terminals: terminalsFromManifest(M),
});
