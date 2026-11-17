import type { AreaDriver } from './types';
import { bleDriver } from './ble';
import { irDriver } from './ir';
import { usbDriver } from './usb';
import { motionDriver } from './motion';
import { nfcDriver } from './nfc';
import { powerDriver } from './power';
import { rfidDriver } from './rfid';
import { wifiDriver } from './wifi';

export const DRIVERS: readonly AreaDriver[] = [nfcDriver, rfidDriver, wifiDriver, irDriver, powerDriver, motionDriver, bleDriver, usbDriver];
