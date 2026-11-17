import type { AreaId } from './model';

/** Icon tile colour per area (tokens in styles/tokens.css) and glyph id. */
export const AREA_TILE: Record<AreaId, string> = {
  nfc: 'var(--tile-blue)',
  rfid: 'var(--tile-red)',
  wifi: 'var(--tile-amber)',
  ble: 'var(--tile-blue)',
  ir: 'var(--tile-red)',
  sd: 'var(--tile-dark)',
  usb: 'var(--tile-amber)',
  power: 'var(--tile-green)',
  motion: 'var(--tile-blue)',
  part: 'var(--tile-amber)',
};
/** Glyph colour that reads on each tile. */
export const AREA_TILE_INK: Record<AreaId, string> = {
  nfc: '#fff',
  rfid: '#fff',
  wifi: '#191919',
  ble: '#fff',
  ir: '#fff',
  sd: '#fff',
  usb: '#191919',
  power: '#fff',
  motion: '#fff',
  part: '#191919',
};
