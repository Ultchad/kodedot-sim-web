import type { ButtonId } from '../device/types';

/** Keyboard shortcuts: T = top, B = bottom, arrows = D-pad. Modified combos (Ctrl/Alt/Meta) are ignored. */
export function keyToButton(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): ButtonId | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  switch (e.key) {
    case 't':
    case 'T':
      return 'top';
    case 'b':
    case 'B':
      return 'bottom';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

/** True when typing should win over device shortcuts (inputs, textareas, selects, contenteditable). */
export function isEditableTarget(t: unknown): boolean {
  const el = t as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el || typeof el !== 'object') return false;
  const tag = (el.tagName ?? '').toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * True when the focused widget needs the arrow keys for itself (tabs, menus, sliders, scroll regions), so they must not
 * reach the D-pad. Widgets opt in with the role they already carry, or with `data-arrow-keys`.
 */
export function ownsArrowKeys(t: unknown): boolean {
  const el = t as { closest?: (sel: string) => unknown } | null;
  if (!el || typeof el.closest !== 'function') return false;
  return !!el.closest('[role=tablist], [role=menu], [role=slider], [role=separator], [data-arrow-keys]');
}

export const KEY_HINT: Record<ButtonId, string> = {
  top: 'T',
  bottom: 'B',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};
