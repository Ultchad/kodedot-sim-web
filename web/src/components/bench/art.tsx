import type { ReactNode } from 'react';

/** Little drawn objects for the bench cards: flat, warm, from the page's own colours. */

/** Bars from a signal in dBm (-90 weak .. -30 strong). */
export const signalBars = (dbm: number): number => (dbm >= -55 ? 4 : dbm >= -67 ? 3 : dbm >= -78 ? 2 : dbm >= -88 ? 1 : 0);

export function SignalBars({ dbm, on = true }: { dbm: number; on?: boolean }) {
  const n = on ? signalBars(dbm) : 0;
  return (
    <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden className="shrink-0">
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={i * 7} y={16 - i * 5 - 3} width="5" height={4 + i * 5} rx="1.6" fill={i < n ? 'var(--ink)' : 'var(--ink)'} opacity={i < n ? 1 : 0.2} />
      ))}
    </svg>
  );
}

/** A TV whose screen shows what the Dot made it do. */
export function TvArt({ power, volume, channel, muted }: { power: boolean; volume: number; channel: number; muted: boolean }) {
  return (
    <svg viewBox="0 0 220 140" className="block h-auto w-full max-w-[260px]" role="img" aria-hidden data-testid="tv-art" data-power={power}>
      <rect x="6" y="6" width="208" height="112" rx="14" fill="#191919" />
      <rect x="14" y="14" width="192" height="96" rx="8" fill={power ? '#028AC2' : '#2c2a27'} />
      {power && (
        <>
          <rect x="14" y="14" width="192" height="96" rx="8" fill="url(#tvg)" />
          <defs>
            <linearGradient id="tvg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.28" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <text x="196" y="40" textAnchor="end" fontFamily="Outfit, sans-serif" fontWeight="700" fontSize="22" fill="#fff" data-testid="tv-channel">
            {channel}
          </text>
          <g transform="translate(24 84)">
            <path d="M0 6h5l6-5v16l-6-5H0z" fill="#fff" />
            {muted ? <path d="M15 4l8 8M23 4l-8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" /> : <path d="M15 4a6 6 0 0 1 0 8" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" />}
            <rect x="34" y="5" width="140" height="6" rx="3" fill="#fff" opacity="0.3" />
            <rect x="34" y="5" width={muted ? 0 : (140 * volume) / 100} height="6" rx="3" fill="#fff" />
          </g>
        </>
      )}
      {!power && <circle cx="198" cy="102" r="3" fill="#C9303D" />}
      <rect x="64" y="118" width="12" height="12" fill="#191919" />
      <rect x="144" y="118" width="12" height="12" fill="#191919" />
      <rect x="48" y="128" width="124" height="8" rx="4" fill="#191919" />
    </svg>
  );
}

export function BatteryArt({ level, charging }: { level: number; charging: boolean }) {
  const colour = level < 15 ? '#C9303D' : level < 40 ? '#FFAC00' : '#16A34A';
  return (
    <svg viewBox="0 0 120 56" className="block h-14 w-[120px]" role="img" aria-hidden data-testid="battery-art">
      <rect x="3" y="5" width="104" height="46" rx="12" fill="none" stroke="#191919" strokeWidth="4" />
      <rect x="107" y="19" width="8" height="18" rx="3" fill="#191919" />
      <rect x="10" y="12" width={Math.max(0, (90 * level) / 100)} height="32" rx="7" fill={colour} />
      {charging && <path d="M62 8l-14 24h12l-4 16 16-26H60z" fill="#191919" stroke="#DED7CD" strokeWidth="2" strokeLinejoin="round" />}
    </svg>
  );
}

/** A door reader's light: grey while it waits, green for the number it grants, red for another. */
export function DoorArt({ state }: { state: 'waiting' | 'granted' | 'denied' }) {
  const fill = state === 'granted' ? '#16A34A' : state === 'denied' ? '#C9303D' : '#8a857d';
  return (
    <svg viewBox="0 0 64 88" className="block h-[88px] w-16 shrink-0" role="img" aria-hidden data-testid="door-art" data-state={state}>
      <rect x="4" y="2" width="56" height="84" rx="14" fill="#191919" />
      <circle cx="32" cy="28" r="14" fill={fill} />
      {state === 'granted' && <path d="M25 28l5 5 9-10" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
      {state === 'denied' && <path d="M26 22l12 12M38 22l-12 12" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />}
      <rect x="16" y="52" width="32" height="6" rx="3" fill="#fff" opacity="0.25" />
      <circle cx="32" cy="70" r="5" fill="none" stroke="#fff" strokeWidth="2" opacity="0.5" />
    </svg>
  );
}

export function Well({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`well p-3 ${className}`}>{children}</div>;
}
