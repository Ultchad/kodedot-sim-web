import type { ReactNode } from 'react';
import { APP_PACKAGE_EXT } from '../lib/appPackage';
import type { FigureId } from './sections';

/**
 * The guide's pictures: small drawings in the site's own colours (they follow the light and dark theme through the
 * tokens), not screenshots, so nothing here goes stale with the UI. Words inside a picture are only names that are
 * the same in every language (keys, pin names, file names); the caption under it carries the sentence.
 */

// The Dot's front, from web/public/device/kode-dot.json (pixels of the 602 x 979 render).
const DOT = {
  w: 602,
  h: 979,
  body: { x: 12, y: 13, w: 577, h: 953, r: 86 },
  bezel: { x: 62, y: 66, w: 478, h: 570, r: 132 },
  screen: { x: 96, y: 100, w: 410, h: 502, r: 104 },
  top: { cx: 461.5, cy: 731.3, r: 59.5, colour: '#028AC2' },
  bottom: { cx: 403.2, cy: 871.4, r: 59.5, colour: '#C9303D' },
  dpad: { cx: 198.8, cy: 801.4, span: 254, arm: 74 },
};
const SHELL = '#ebe3d5';
const SHELL_EDGE = '#cfc6b6';
const DARK = '#1c1c1c';

function DotFront({ children }: { children?: ReactNode }) {
  const d = DOT.dpad;
  const half = d.span / 2;
  const arm = d.arm / 2;
  return (
    <g>
      <rect x={DOT.body.x} y={DOT.body.y} width={DOT.body.w} height={DOT.body.h} rx={DOT.body.r} fill={SHELL} stroke={SHELL_EDGE} strokeWidth="4" />
      <rect x={DOT.bezel.x} y={DOT.bezel.y} width={DOT.bezel.w} height={DOT.bezel.h} rx={DOT.bezel.r} fill={DARK} />
      <rect x={DOT.screen.x} y={DOT.screen.y} width={DOT.screen.w} height={DOT.screen.h} rx={DOT.screen.r} fill="#000" stroke="#3a3a3a" strokeWidth="3" />
      {/* light guide, top right corner */}
      <path d="M505 37h30a29 29 0 0 1 29 29v30z" fill="#9fd4ec" />
      {/* D-pad */}
      <path
        d={`M${d.cx - arm} ${d.cy - half}h${d.arm}v${half - arm}h${half - arm}v${d.arm}h${-(half - arm)}v${half - arm}h${-d.arm}v${-(half - arm)}h${-(half - arm)}v${-d.arm}h${half - arm}z`}
        fill={DARK}
        stroke={DARK}
        strokeWidth="26"
        strokeLinejoin="round"
      />
      {[DOT.top, DOT.bottom].map((b) => (
        <g key={b.colour}>
          <circle cx={b.cx} cy={b.cy} r={b.r} fill={DARK} />
          <circle cx={b.cx} cy={b.cy} r={b.r * 0.6} fill={b.colour} />
        </g>
      ))}
      {children}
    </g>
  );
}

/** A key cap, as the page's own <kbd>. */
function Key({ x, y, label, w = 64 }: { x: number; y: number; label: string; w?: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - 30} width={w} height={60} rx="16" fill="var(--raised)" stroke="var(--ink)" strokeWidth="3" />
      <text x={x} y={y + 11} textAnchor="middle" fontSize="32" fontWeight="700" fill="var(--ink)" fontFamily="var(--font-body)">
        {label}
      </text>
    </g>
  );
}

const leader = (x1: number, y1: number, x2: number, y2: number) => <path d={`M${x1} ${y1}L${x2} ${y2}`} stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" fill="none" />;

/** The swipe that unlocks kodeOS: a finger mark and an arrow across the screen. */
function Swipe() {
  const y = DOT.screen.y + DOT.screen.h * 0.56;
  const x0 = DOT.screen.x + DOT.screen.w - 86;
  const x1 = DOT.screen.x + 96;
  return (
    <g>
      <circle cx={x0} cy={y} r="30" fill="var(--primary)" opacity="0.35" />
      <circle cx={x0} cy={y} r="15" fill="var(--primary)" />
      <path d={`M${x0 - 44} ${y}H${x1}`} stroke="var(--primary)" strokeWidth="9" strokeLinecap="round" strokeDasharray="2 22" />
      <path d={`M${x1 + 30} ${y - 26}L${x1} ${y}l30 26`} stroke="var(--primary)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </g>
  );
}

function FigDot() {
  return (
    <svg viewBox="0 0 602 979" className="guide-fig-dot" aria-hidden>
      <DotFront>
        <Swipe />
      </DotFront>
    </svg>
  );
}

function FigControls() {
  // the Dot in the middle, key caps on both sides with a line to what they press
  const ox = 250;
  return (
    <svg viewBox="0 0 1100 979" className="guide-fig-wide" aria-hidden>
      <g transform={`translate(${ox} 0)`}>
        <DotFront>
          <Swipe />
        </DotFront>
      </g>
      {/* top and bottom buttons: to the right */}
      {leader(ox + DOT.top.cx + 62, DOT.top.cy, 930, DOT.top.cy - 40)}
      <Key x={970} y={DOT.top.cy - 40} label="T" />
      {leader(ox + DOT.bottom.cx + 62, DOT.bottom.cy, 930, DOT.bottom.cy + 20)}
      <Key x={970} y={DOT.bottom.cy + 20} label="B" />
      {/* D-pad: to the left */}
      {leader(ox + DOT.dpad.cx - 132, DOT.dpad.cy, 214, DOT.dpad.cy)}
      <Key x={110} y={DOT.dpad.cy - 68} label="↑" />
      <Key x={40} y={DOT.dpad.cy} label="←" />
      <Key x={110} y={DOT.dpad.cy} label="↓" />
      <Key x={180} y={DOT.dpad.cy} label="→" />
    </svg>
  );
}

/** The table seen from above: the Dot, the range of one of its radios, one thing inside it and one outside. */
function FigRange({ near, away }: { near: string; away: string }) {
  const tag = (x: number, y: number, on: boolean) => (
    <g opacity={on ? 1 : 0.55}>
      <rect x={x - 34} y={y - 34} width="68" height="68" rx="18" fill={on ? 'var(--tile-blue)' : 'var(--ink3)'} />
      <g stroke="#fff" strokeWidth="5" strokeLinecap="round" fill="none">
        <circle cx={x} cy={y} r="5" fill="#fff" stroke="none" />
        <path d={`M${x - 13} ${y - 13}a18 18 0 0 0 0 26M${x + 13} ${y - 13}a18 18 0 0 1 0 26`} />
      </g>
    </g>
  );
  return (
    <svg viewBox="0 0 760 330" className="guide-fig-wide" aria-hidden>
      <rect x="6" y="6" width="748" height="318" rx="28" fill="var(--raised-soft)" />
      {/* 10 mm grid marks of the mat */}
      <g fill="var(--ink)" opacity="0.18">
        {Array.from({ length: 7 }, (_, r) => Array.from({ length: 17 }, (_, c) => <circle key={`${r}-${c}`} cx={50 + c * 42} cy={40 + r * 42} r="2.5" />))}
      </g>
      <circle cx="250" cy="165" r="128" fill="var(--primary)" opacity="0.16" />
      <circle cx="250" cy="165" r="128" fill="none" stroke="var(--primary)" strokeWidth="4" strokeDasharray="10 9" />
      {/* the Dot, lying on the table */}
      <g transform="translate(205 92) scale(0.15)">
        <DotFront />
      </g>
      {tag(322, 190, true)}
      {tag(600, 190, false)}
      <path d="M386 190h150" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 12" />
      <path d="M398 178l-14 12 14 12M524 178l14 12-14 12" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <text x="322" y="278" textAnchor="middle" fontSize="21" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-body)">
        {near}
      </text>
      <text x="600" y="278" textAnchor="middle" fontSize="21" fontWeight="600" fill="var(--ink2)" fontFamily="var(--font-body)">
        {away}
      </text>
    </svg>
  );
}

/** The worked example's circuit: header pin, resistor, LED, ground. */
function FigLed() {
  const label = (x: number, y: number, s: string, weight = 600) => (
    <text x={x} y={y} textAnchor="middle" fontSize="22" fontWeight={weight} fill="var(--ink)" fontFamily="var(--font-body)">
      {s}
    </text>
  );
  return (
    <svg viewBox="0 0 760 250" className="guide-fig-wide" aria-hidden>
      <rect x="6" y="6" width="748" height="238" rx="28" fill="var(--raised-soft)" />
      {/* the Dot's header: two of its pins */}
      <rect x="40" y="50" width="150" height="150" rx="24" fill={SHELL} stroke={SHELL_EDGE} strokeWidth="3" />
      <text x="115" y="92" textAnchor="middle" fontSize="20" fontWeight="700" fill="#191919" fontFamily="var(--font-heading)">
        Dot
      </text>
      <circle cx="190" cy="120" r="9" fill="var(--primary)" stroke="#191919" strokeWidth="3" />
      <circle cx="190" cy="172" r="9" fill="#191919" />
      <text x="174" y="127" textAnchor="end" fontSize="19" fontWeight="600" fill="#191919" fontFamily="var(--font-body)">
        EXP1
      </text>
      <text x="174" y="179" textAnchor="end" fontSize="19" fontWeight="600" fill="#191919" fontFamily="var(--font-body)">
        GND
      </text>
      {/* signal wire, resistor, LED */}
      <path d="M199 120H330" stroke="var(--primary)" strokeWidth="6" strokeLinecap="round" />
      <rect x="330" y="104" width="96" height="32" rx="10" fill="#d9b98a" stroke="var(--ink)" strokeWidth="3" />
      <g strokeWidth="6">
        <path d="M352 106v28" stroke="#c9303d" />
        <path d="M372 106v28" stroke="#c9303d" />
        <path d="M392 106v28" stroke="#6b4a2a" />
      </g>
      <path d="M426 120H520" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
      <path d="M520 96v48l44-24z" fill="var(--red)" stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M564 96v48" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
      <g stroke="var(--red)" strokeWidth="4" strokeLinecap="round">
        <path d="M548 82l12-16M566 86l12-16" />
      </g>
      <path d="M564 120H690V172H199" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {label(378, 86, '220 Ω')}
      {label(512, 172 - 12, 'A')}
      {label(580, 172 - 12, 'K')}
    </svg>
  );
}

/** An app folder goes through the build tool and comes out as one package the page installs. */
function FigPackage() {
  const mono = { fontFamily: 'var(--font-mono-log)', fontSize: 19, fill: 'var(--ink)' } as const;
  const box = (x: number, w: number, title: string, lines: string[], accent = false) => (
    <g>
      <rect x={x} y="34" width={w} height="212" rx="22" fill={accent ? 'var(--primary)' : 'var(--raised)'} opacity={accent ? 0.9 : 1} />
      <text x={x + 20} y="70" fontSize="20" fontWeight="700" fill={accent ? '#191919' : 'var(--ink)'} fontFamily="var(--font-heading)">
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l} x={x + 20} y={104 + i * 27} {...mono} fill={accent ? '#191919' : 'var(--ink)'}>
          {l}
        </text>
      ))}
    </g>
  );
  const arrow = (x: number) => (
    <g stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <path d={`M${x} 140h44`} />
      <path d={`M${x + 32} 128l12 12-12 12`} />
    </g>
  );
  return (
    <svg viewBox="0 0 860 280" className="guide-fig-wide" aria-hidden>
      <rect x="6" y="6" width="848" height="268" rx="28" fill="var(--raised-soft)" />
      {box(30, 236, 'my_app/', ['CMakeLists.txt', 'main/*.c', 'appdata/app.json', 'appdata/icon.png'])}
      {arrow(278)}
      {box(334, 250, `my_app${APP_PACKAGE_EXT}`, ['my_app.wasm', 'my_app.js', 'glue/…', 'appdata/app.json', 'icon.png'], true)}
      {arrow(596)}
      <g transform="translate(676 44) scale(0.2)">
        <DotFront />
      </g>
      <text x="300" y="262" textAnchor="middle" {...mono} fontSize="15" fill="var(--ink2)">
        tools/dotbench build
      </text>
    </svg>
  );
}

export function Figure({ id, near, away }: { id: FigureId; near: string; away: string }) {
  switch (id) {
    case 'dot':
      return <FigDot />;
    case 'controls':
      return <FigControls />;
    case 'range':
      return <FigRange near={near} away={away} />;
    case 'led':
      return <FigLed />;
    case 'package':
      return <FigPackage />;
  }
}
