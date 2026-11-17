/**
 * Half-size solderless breadboard (400 tie points): 30 columns of two strips of five holes, four power rails.
 * Body, holes and legends come from parts/breadboard-half/manifest.json through ./breadboard.ts (read its header).
 */
import manifest from '../../../../../parts/breadboard-half/manifest.json';
import { breadboardModel } from './breadboard';

export default breadboardModel(manifest, 'Breadboard, half size (400 points)');
