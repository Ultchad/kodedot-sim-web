import type { ReactNode } from 'react';
import { AREA_TILE, AREA_TILE_INK } from '../bench/appearance';
import type { AreaId } from '../bench/model';

/** Simple original glyphs, one per bench area (24px grid, stroke only). */
const PATHS: Record<AreaId, ReactNode> = {
  nfc: (
    <>
      <circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
    </>
  ),
  rfid: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M7 14h5" />
      <circle cx="16.5" cy="10.5" r="1.4" />
    </>
  ),
  wifi: (
    <>
      <rect x="3" y="13" width="18" height="6.5" rx="2.2" />
      <path d="M7 13V7M17 13V7M7.5 16.3h.01M11 16.3h.01" />
    </>
  ),
  ble: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="3" />
      <path d="M10.5 18.2h3" />
    </>
  ),
  ir: (
    <>
      <rect x="8" y="2.5" width="8" height="19" rx="4" />
      <circle cx="12" cy="7.5" r="1.4" />
      <path d="M12 12.2h.01M12 16.2h.01" />
    </>
  ),
  sd: (
    <>
      <path d="M7 2.8h7.6L19 7.2V19a2.2 2.2 0 0 1-2.2 2.2H7A2.2 2.2 0 0 1 4.8 19V5A2.2 2.2 0 0 1 7 2.8z" />
      <path d="M9 6.2v3M12 6.2v3M15 6.2v3" />
    </>
  ),
  usb: (
    <>
      <path d="M6 3h4v5H6zM14 3h4v5h-4z" />
      <path d="M8 8v3a4 4 0 0 0 4 4 4 4 0 0 0 4-4V8M12 15v6" />
    </>
  ),
  power: (
    <>
      <rect x="2.5" y="8" width="17" height="9" rx="3" />
      <path d="M22 11.2v2.6M11.2 10.2l-2 3h3.6l-2 3" />
    </>
  ),
  part: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M10 7V4M14 7V4M10 20v-3M14 20v-3M7 10H4M7 14H4M20 10h-3M20 14h-3" />
    </>
  ),
  motion: (
    <>
      <rect x="8" y="3" width="8" height="13" rx="2.2" transform="rotate(22 12 9.5)" />
      <path d="M4.5 19.5a9.5 9.5 0 0 0 15 0" />
    </>
  ),
};

export function Glyph({ area, size = 28 }: { area: AreaId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[area]}
    </svg>
  );
}

export function IconTile({ area, size = 48, dim = false }: { area: AreaId; size?: number; dim?: boolean }) {
  return (
    <span className="icon-tile" style={{ width: size, height: size, background: AREA_TILE[area], color: AREA_TILE_INK[area], opacity: dim ? 0.55 : 1 }} aria-hidden>
      <Glyph area={area} size={Math.round(size * 0.45)} />
    </span>
  );
}

/** Interface icons: same 24 px grid and 1.8 px round stroke as the area glyphs, so every icon on the page is one family. */
const ICONS = {
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronUp: <path d="M6 14.5l6-6 6 6" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  pencil: <path d="M4.5 19.5l1-4L16.2 4.8a1.8 1.8 0 0 1 2.6 0l.4.4a1.8 1.8 0 0 1 0 2.6L8.5 18.5l-4 1zM14.5 6.5l3 3" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 5.5v-.2A1.8 1.8 0 0 0 13.7 3.5H6.3A1.8 1.8 0 0 0 4.5 5.3v7.4a1.8 1.8 0 0 0 1.8 1.8h.2" />
    </>
  ),
  trash: <path d="M5 7h14M10 7V4.8h4V7M7 7l.8 11.2a1.8 1.8 0 0 0 1.8 1.6h4.8a1.8 1.8 0 0 0 1.8-1.6L17 7M10.2 11v5M13.8 11v5" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M6 18l1.4-1.4M16.6 7.4L18 6" />
    </>
  ),
  moon: <path d="M19.5 14.2A8 8 0 0 1 9.8 4.5a8 8 0 1 0 9.7 9.7z" />,
  restart: <path d="M19.5 12a7.5 7.5 0 1 1-2.6-5.7M19.5 4.5v4h-4" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.2" />,
  play: <path d="M8.5 5.8v12.4l10-6.2-10-6.2z" />,
  open: <path d="M12 15.5v-11M7.5 8.5l4.5-4.5 4.5 4.5M4.5 14.5v3.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-3.2" />,
  download: <path d="M12 4.5v11M7.5 11.5l4.5 4.5 4.5-4.5M4.5 15.5v2.2a1.8 1.8 0 0 0 1.8 1.8h11.4a1.8 1.8 0 0 0 1.8-1.8v-2.2" />,
  keyboard: (
    <>
      <rect x="2.8" y="6" width="18.4" height="12" rx="2.6" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  panelLeft: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  panelRight: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  home: <path d="M4.5 11.2L12 4.5l7.5 6.7M6.5 9.8v8.2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V9.8M10 19.5v-5h4v5" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  recenter: (
    <>
      <circle cx="12" cy="12" r="2.2" />
      <path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4" />
    </>
  ),
  arrowDown: <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  send: <path d="M5 12h13M12.5 6.5L18 12l-5.5 5.5" />,
  folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  file: <path d="M7 3.5h7l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM14 3.5V8h4.5" />,
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  cube: <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7L12 3.5zM4.5 7.7l7.5 4.3 7.5-4.3M12 12v8.5" />,
  undo: <path d="M8.5 5.5L4.5 9.5l4 4M4.5 9.5h9.2a5.3 5.3 0 0 1 0 10.6H9.5" />,
  redo: <path d="M15.5 5.5l4 4-4 4M19.5 9.5h-9.2a5.3 5.3 0 0 0 0 10.6h4.2" />,
  rotate: <path d="M19 12a7 7 0 1 1-2.1-5M19.5 3.8v4.4h-4.4" />,
  table: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2.6" />
      <rect x="10" y="9.2" width="4" height="5.6" rx="1" />
    </>
  ),
  device: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2.8" />
      <path d="M10 6.5h4M12 17.2h.01" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className ?? ''}`}>
      {ICONS[name]}
    </svg>
  );
}
