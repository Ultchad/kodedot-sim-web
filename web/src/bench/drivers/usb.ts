/**
 * The computer on a USB cable (docs/STATUS-usb.md): plugging it gives the Dot a host on its USB-C port, with a serial
 * terminal, file transfer and "install an app over USB". It shares the one connector with the charger: the store's
 * rule (runtime) is that plugging one takes the other's cable out.
 */
import type { BenchObject, KindDef } from '../model';
import type { AreaDriver } from './types';

export const USB_COMPUTER = 'usb.computer';

export const usbKinds: KindDef[] = [
  {
    key: USB_COMPUTER,
    area: 'usb',
    labelKey: 'kind.usb.computer',
    descKey: 'kind.usb.computer.desc',
    addKey: 'kind.usb.computer.add',
    single: true,
    fields: [{ key: 'host', labelKey: 'field.usbHost', type: 'toggle' }],
    defaults: { host: true },
    presence: { on: 'presence.plugged', off: 'presence.unplugged' },
  },
];

/** runtime/web-adapter/usb-computer.js: the computer's side of the cable (it re-applies itself after a restart). */
export interface Computer {
  plug(o?: { host?: boolean }): boolean;
  unplug(): boolean;
  readonly plugged: boolean;
  setHost(on: boolean): void;
  terminal(): string;
  type(line: string): number;
  filePut(path: string, data: Uint8Array): Promise<unknown>;
  fileGet(path: string): Promise<{ data: Uint8Array }>;
  installPackage(bytes: Uint8Array, o?: { via?: 'direct' | 'mailbox'; run?: boolean }): Promise<unknown>;
}

let systemOf: (() => Promise<unknown>) | null = null;
const computers = new WeakMap<object, Computer>();
/** The page says how to reach the running system (state/host.tsx). */
export function setUsbSystem(f: (() => Promise<unknown>) | null): void {
  systemOf = f;
}
/** The computer on the cable of the system that runs now, or null when no Dot runs. */
export async function computer(): Promise<Computer | null> {
  if (!systemOf) return null;
  try {
    const sys = (await systemOf()) as object | null;
    if (!sys) return null;
    let c = computers.get(sys);
    if (!c) {
      const { UsbComputer } = (await import('../../generated/web-adapter/usb-computer.js')) as { UsbComputer: new (sys: object) => Computer };
      c = new UsbComputer(sys);
      computers.set(sys, c);
    }
    return c;
  } catch {
    return null;
  }
}

function apply(o: BenchObject): void {
  void computer().then((c) => {
    if (!c) return;
    if (o.near) {
      if (!c.plugged) c.plug({ host: o.fields.host !== false });
      c.setHost(o.fields.host !== false);
    } else if (c.plugged) c.unplug();
  });
}

export const usbDriver: AreaDriver<unknown, string> = {
  area: 'usb',
  deviceArea: 'usb',
  events: [],
  sig: (o) => JSON.stringify([o.kind, o.fields]),
  create(_api, o) {
    apply(o);
    return o.kind;
  },
  update(_api, _h, o) {
    apply(o);
  },
  remove() {
    void computer().then((c) => c?.plugged && c.unplug());
  },
  poll(_api, objects, ctx) {
    for (const o of objects) {
      void computer().then((c) => {
        if (!c) return;
        if (c.plugged !== o.near) apply(o); // the firmware forgot the cable at a restart
        ctx.live.setData(o.id, { plugged: c.plugged, text: c.terminal().slice(-1500) });
      });
    }
  },
};
