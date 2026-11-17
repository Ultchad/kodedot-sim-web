import { useEffect, useState } from 'react';

/**
 * Pictures of the library parts' 3D models, rendered by scripts/part-thumbs.mjs and committed under public/parts-thumbs/.
 * index.json lists them; a part that is not listed (and any part the visitor imports) keeps the generic icon.
 */
export interface ThumbIndex {
  size: number;
  cssSize: number;
  thumbs: Record<string, string>;
  fallback: string[];
}

const BASE = `${import.meta.env.BASE_URL}parts-thumbs/`;
let loaded: ThumbIndex | null = null;
let pending: Promise<ThumbIndex | null> | null = null;

export function loadThumbs(): Promise<ThumbIndex | null> {
  pending ??= fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<ThumbIndex>) : null))
    .catch(() => null)
    .then((j) => (loaded = j));
  return pending;
}

/** The URL of a library part's picture, or undefined (not loaded yet, imported by the visitor, or no picture). */
export const thumbUrl = (id: string, user?: boolean): string | undefined => {
  const f = !user && loaded?.thumbs[id];
  return f ? `${BASE}${f}` : undefined;
};

export function useThumbs(): void {
  const [, set] = useState(loaded ? 1 : 0);
  useEffect(() => {
    if (!loaded) void loadThumbs().then(() => set(1));
  }, []);
}
