import type { AreaDriver } from './types';
import { irDriver } from './ir';
import { motionDriver } from './motion';
import { nfcDriver } from './nfc';
import { powerDriver } from './power';
import { rfidDriver } from './rfid';
import { wifiDriver } from './wifi';

export const DRIVERS: readonly AreaDriver[] = [nfcDriver, rfidDriver, wifiDriver, irDriver, powerDriver, motionDriver];
