/**
 * Full-size solderless breadboard (830 tie points): 63 columns of two strips of five holes, four power rails.
 * Body, holes and legends come from parts/breadboard-full/manifest.json through ./breadboard.ts (read its header).
 */
import manifest from '../../../../../parts/breadboard-full/manifest.json';
import { breadboardModel } from './breadboard';

export default breadboardModel(manifest, 'Breadboard, full size (830 points)');
