import type { MouseEvent, ReactNode } from 'react';
import { guideHash, isSectionId, type SectionId } from './route';

/** One piece of a guide text after its inline marks were read. */
export type Piece =
  | { t: 'text'; s: string }
  | { t: 'bold'; s: string }
  | { t: 'code'; s: string }
  | { t: 'key'; s: string }
  | { t: 'section'; s: string; to: SectionId }
  | { t: 'link'; s: string; href: string };

const MARK = /(\*\*[^*]+\*\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]+\]\([^)\s]+\))/g;

/** Reads the inline marks of a guide text: **bold**, `code`, [[Key]], [text](#section) and [text](https://...). */
export function parseInline(text: string): Piece[] {
  const out: Piece[] = [];
  for (const p of text.split(MARK)) {
    if (!p) continue;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) out.push({ t: 'bold', s: p.slice(2, -2) });
    else if (p.startsWith('`') && p.endsWith('`') && p.length > 2) out.push({ t: 'code', s: p.slice(1, -1) });
    else if (p.startsWith('[[') && p.endsWith(']]')) out.push({ t: 'key', s: p.slice(2, -2) });
    else if (p.startsWith('[') && p.endsWith(')') && p.includes('](')) {
      const i = p.indexOf('](');
      const label = p.slice(1, i);
      const target = p.slice(i + 2, -1);
      if (target.startsWith('#')) {
        const id = target.slice(1);
        // a link to a section that does not exist would be a dead end: the test refuses it, and it is shown as plain text
        out.push(isSectionId(id) ? { t: 'section', s: label, to: id } : { t: 'text', s: label });
      } else out.push({ t: 'link', s: label, href: target });
    } else out.push({ t: 'text', s: p });
  }
  return out;
}

/** The section ids and outside addresses a text links to (for the tests). */
export const linksOf = (text: string): string[] => [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);

export function Inline({ text, onSection, newTab }: { text: string; onSection(id: SectionId): void; newTab: string }) {
  const nodes: ReactNode[] = parseInline(text).map((p, i) => {
    switch (p.t) {
      case 'bold':
        return <strong key={i}>{p.s}</strong>;
      case 'code':
        return <code key={i}>{p.s}</code>;
      case 'key':
        return <kbd key={i}>{p.s}</kbd>;
      case 'section':
        return (
          <a
            key={i}
            href={guideHash(p.to)}
            onClick={(e: MouseEvent) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // a new tab or window is the visitor's choice
              e.preventDefault();
              onSection(p.to);
            }}
          >
            {p.s}
          </a>
        );
      case 'link':
        return (
          <a key={i} href={p.href} target="_blank" rel="noreferrer noopener">
            {p.s}
            <span className="sr-only"> ({newTab})</span>
          </a>
        );
      default:
        return p.s;
    }
  });
  return <>{nodes}</>;
}
