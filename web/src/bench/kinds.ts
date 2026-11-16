import type { AreaId, KindDef } from './model';
import { motionKind } from './motion';

/** Registry of the object kinds that exist today. Later stages append here. */
export const KINDS: KindDef[] = [motionKind];

export const getKind = (key: string): KindDef | undefined => KINDS.find((k) => k.key === key);
export const kindsOf = (area: AreaId): KindDef[] => KINDS.filter((k) => k.area === area);
