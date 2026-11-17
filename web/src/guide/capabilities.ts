import type { GuideKey } from './content';

/**
 * What each piece of the Dot's hardware does on this page today: works, partly, or not simulated. One row per area,
 * each taken from the area's own status file (docs/STATUS-*.md, named in `from`); a row changes when that file does.
 */
export type CapabilityState = 'works' | 'partial' | 'none';
export interface Capability {
  id: string;
  state: CapabilityState;
  area: GuideKey;
  detail: GuideKey;
  /** The status files the row was written from. */
  from: string[];
}

const row = (id: string, state: CapabilityState, from: string[]): Capability => ({ id, state, area: `sim.${id}` as GuideKey, detail: `sim.${id}.d` as GuideKey, from });

export const CAPABILITIES: readonly Capability[] = [
  row('system', 'works', ['kodeos', 'integration-2']),
  row('screen', 'works', ['foundation', 'web']),
  row('storage', 'works', ['persistence', 'web']),
  row('sd', 'works', ['web']),
  row('nfc', 'works', ['nfc']),
  row('rfid', 'works', ['rfid']),
  row('ir', 'works', ['ir', 'apps']),
  row('power', 'works', ['sensors']),
  row('motion', 'works', ['sensors']),
  row('exp', 'works', ['parts']),
  row('wifi', 'partial', ['radio', 'web']),
  row('ble', 'partial', ['ble']),
  row('usb', 'partial', ['usb']),
  row('audio', 'partial', ['audio', 'web']),
  row('circuit', 'partial', ['parts']),
  row('boards', 'partial', ['cc', 'parts']),
  row('modules', 'partial', ['parts']),
  row('shape', 'none', ['parts']),
  row('camera', 'none', ['kodeos', 'parts']),
];
