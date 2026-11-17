/** The live state the Workbench hands to the models of the wireless bench objects (tags, readers, router, TV ...). */
export interface WirelessState {
  /** Near the Dot / in range / aimed at it / plugged in. */
  near: boolean;
  /** The object's own settings (bench/drivers: the kind's fields). */
  fields: Readonly<Record<string, string | number | boolean>>;
  /** What the Dot did with it lately (bench/live.ts `data` of the object). */
  live: Readonly<Record<string, unknown>>;
  /** Live data of the object's whole area (the Wi-Fi station connecting, the NFC field on). */
  area: Readonly<Record<string, unknown>>;
  /** Seconds since the Dot last did something with this object; Infinity when it never did. */
  sinceEvent: number;
  /** How that last thing went. */
  tone: 'info' | 'ok' | 'bad';
  /** The button held down on it (a remote), or null. */
  pressed: string | null;
}

export const IDLE: WirelessState = { near: false, fields: {}, live: {}, area: {}, sinceEvent: Infinity, tone: 'info', pressed: null };
export const state = (o: Partial<WirelessState>): WirelessState => ({ ...IDLE, ...o });
