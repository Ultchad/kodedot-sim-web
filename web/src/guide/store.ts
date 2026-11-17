import { useSyncExternalStore } from 'react';
import { guideHash, parseGuideHash, type GuideRoute, type SectionId } from './route';

/**
 * Whether the guide is open, and on which section. The URL's hash is the truth, so a pasted link opens the guide
 * directly and Back closes it. Nothing else of the page reads the hash; the query string is left alone.
 */
const listeners = new Set<() => void>();
const read = (): GuideRoute => parseGuideHash(typeof location === 'undefined' ? '' : location.hash);
let state: GuideRoute = read();
/** True when this page pushed the history entry the guide sits on: closing then goes back instead of leaving a spare entry. */
let pushed = false;
/** True between a close that goes back in history and the browser's answer to it. */
let closing = false;

function set(next: GuideRoute): void {
  if (next.open === state.open && next.section === state.section) return;
  state = next;
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  const sync = () => {
    let next = read();
    if (closing) {
      closing = false;
      // the entry behind the guide was another guide link (the visitor walked through sections by links): clear it
      if (next.open) history.replaceState(history.state, '', urlWith(''));
      next = { open: false, section: state.section };
    }
    if (!next.open) {
      pushed = false;
      next = { open: false, section: state.section }; // the section is remembered for the next opening
    }
    set(next);
  };
  window.addEventListener('hashchange', sync);
  window.addEventListener('popstate', sync);
}

const urlWith = (hash: string): string => `${location.pathname}${location.search}${hash}`;

/** What was pressed to open the guide: closing gives focus back to it (a click does not focus a button in every browser). */
let opener: HTMLElement | null = null;
export function takeOpener(): HTMLElement | null {
  const o = opener;
  opener = null;
  return o;
}

/**
 * Opens the guide (on `section`, or where the visitor left it this visit), or moves an open guide to `section`.
 * `from` is the control that was pressed, when there is one.
 */
export function openGuide(section?: SectionId, from?: HTMLElement | null): void {
  const to = section ?? state.section;
  if (!state.open) opener = from ?? null;
  if (state.open) history.replaceState(history.state, '', urlWith(guideHash(to)));
  else {
    history.pushState(history.state, '', urlWith(guideHash(to)));
    pushed = true;
  }
  set({ open: true, section: to });
}

/** Closes the guide. The page under it was never unloaded: the visitor is back where they were. */
export function closeGuide(): void {
  if (!state.open) return;
  const section = state.section;
  if (pushed) {
    pushed = false;
    closing = true;
    set({ open: false, section });
    history.back();
  } else {
    history.replaceState(history.state, '', urlWith(''));
    set({ open: false, section });
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const get = () => state;

export const useGuideRoute = (): GuideRoute => useSyncExternalStore(subscribe, get, get);
