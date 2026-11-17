/**
 * The guide's place in the URL: `#guide` opens it on its first section, `#guide/<section>` on that section.
 * Section ids are part of links people paste elsewhere: never rename one, add an alias in ALIASES instead.
 */
export const SECTION_IDS = ['start', 'using-the-dot', 'apps', 'bench', 'workbench', 'sketches', 'your-own-app', 'your-own-parts', 'what-is-simulated', 'help'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export const GUIDE_HASH = 'guide';

/** Old or mistyped ids that still land on the right section. */
const ALIASES: Record<string, SectionId> = {
  'what-this-is': 'start',
  dot: 'using-the-dot',
  'installed-apps': 'apps',
  'writing-sketches': 'sketches',
  'own-app': 'your-own-app',
  'app-package': 'your-own-app',
  'own-parts': 'your-own-parts',
  parts: 'your-own-parts',
  simulated: 'what-is-simulated',
  problems: 'help',
  faq: 'help',
};

export const isSectionId = (x: string): x is SectionId => (SECTION_IDS as readonly string[]).includes(x);

export interface GuideRoute {
  open: boolean;
  /** The section the URL names; the first one when it names none or an unknown one. */
  section: SectionId;
}

/** Reads `location.hash` (with or without the leading #). Anything that is not the guide's reads as closed. */
export function parseGuideHash(hash: string): GuideRoute {
  const h = hash.replace(/^#/, '');
  const [head, raw = ''] = h.split('/', 2);
  if (head !== GUIDE_HASH) return { open: false, section: SECTION_IDS[0] };
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* a broken escape: treated as an unknown section */
  }
  id = id.toLowerCase();
  return { open: true, section: isSectionId(id) ? id : (ALIASES[id] ?? SECTION_IDS[0]) };
}

/** The hash of a section (`#guide/bench`). */
export const guideHash = (section: SectionId = SECTION_IDS[0]): string => `#${GUIDE_HASH}/${section}`;
