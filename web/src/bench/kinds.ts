import type { AreaId, KindDef } from './model';
import { irKinds } from './drivers/ir';
import { motionKinds } from './drivers/motion';
import { nfcKinds } from './drivers/nfc';
import { powerKinds } from './drivers/power';
import { rfidKinds } from './drivers/rfid';
import { wifiKinds } from './drivers/wifi';

/** Registry of the object kinds that exist today. A kind is added by listing it in its area's driver file. */
export const KINDS: KindDef[] = [...nfcKinds, ...rfidKinds, ...wifiKinds, ...irKinds, ...powerKinds, ...motionKinds];

export const getKind = (key: string): KindDef | undefined => KINDS.find((k) => k.key === key);
export const kindsOf = (area: AreaId): KindDef[] => KINDS.filter((k) => k.area === area);
