import { useEffect, useRef, type RefObject } from 'react';

/**
 * Floating layers (popovers, menus, drawers, the phone sheet) register here while open.
 * Escape closes only the top-most one; closing hands focus back to whatever had it before the layer opened.
 */
interface Layer {
  close(): void;
}
const stack: Layer[] = [];
let listening = false;

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.close();
}

function listen(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('keydown', onKey, true);
}

export const openLayerCount = (): number => stack.length;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.offsetParent !== null || el.getClientRects().length) return el;
  }
  return null;
}

export interface LayerOptions {
  /** Move focus into the layer when it opens (default true). */
  autoFocus?: boolean;
  /** Close when a pointer goes down outside `ref` and outside `anchor` (default true). */
  dismissOutside?: boolean;
  /** Close when focus moves to an element outside the layer and its anchor (default false). */
  dismissOnBlur?: boolean;
  anchor?: RefObject<HTMLElement | null>;
}

export function useLayer(open: boolean, close: () => void, ref: RefObject<HTMLElement | null>, opts: LayerOptions = {}): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const { autoFocus = true, dismissOutside = true, dismissOnBlur = false, anchor } = opts;
  useEffect(() => {
    if (!open) return;
    listen();
    const layer: Layer = { close: () => closeRef.current() };
    stack.push(layer);
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (autoFocus) {
      const target = firstFocusable(ref.current) ?? ref.current;
      target?.focus({ preventScroll: true });
    }
    const inside = (n: EventTarget | null) => n instanceof Node && (!!ref.current?.contains(n) || !!anchor?.current?.contains(n));
    const down = (e: PointerEvent) => {
      if (dismissOutside && stack[stack.length - 1] === layer && !inside(e.target)) closeRef.current();
    };
    const focusIn = (e: FocusEvent) => {
      if (dismissOnBlur && stack[stack.length - 1] === layer && !inside(e.target)) closeRef.current();
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('focusin', focusIn);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('focusin', focusIn);
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      // give focus back, unless the user already put it somewhere else on purpose
      const cur = document.activeElement;
      const lost = !cur || cur === document.body || !!ref.current?.contains(cur) || !document.contains(cur);
      if (lost && before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [open, ref, anchor, autoFocus, dismissOutside, dismissOnBlur]);
}
