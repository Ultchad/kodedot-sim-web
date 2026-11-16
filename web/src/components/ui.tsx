import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { firstFocusable, useLayer } from '../lib/layers';
import { Icon, type IconName } from './Glyphs';

// ---------------------------------------------------------------- scroll area

/**
 * The one scroll region primitive. It keeps a visible thin scrollbar, fades the edge that hides more content
 * (so it is obvious that the region scrolls), and becomes a tab stop when it overflows and holds nothing focusable.
 */
export function ScrollArea({ className = '', label, children, innerRef, ...rest }: { className?: string; label?: string; children: ReactNode; innerRef?: RefObject<HTMLDivElement | null> } & HTMLAttributes<HTMLDivElement>) {
  const own = useRef<HTMLDivElement>(null);
  const ref = innerRef ?? own;
  const [more, setMore] = useState({ up: false, down: false, overflow: false });
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const overflow = el.scrollHeight - el.clientHeight > 1;
    const up = overflow && el.scrollTop > 1;
    const down = overflow && el.scrollHeight - el.clientHeight - el.scrollTop > 1;
    setMore((m) => (m.up === up && m.down === down && m.overflow === overflow ? m : { up, down, overflow }));
  }, [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of el.children) ro.observe(c);
    const mo = new MutationObserver(() => {
      for (const c of el.children) ro.observe(c);
      measure();
    });
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure, ref]);
  return (
    <div
      ref={ref}
      {...rest}
      onScroll={(e) => {
        measure();
        rest.onScroll?.(e);
      }}
      className={`scroll-area ${className}`}
      data-more-up={more.up}
      data-more-down={more.down}
      data-scroll-area
      data-arrow-keys={more.overflow ? '' : undefined}
      tabIndex={rest.tabIndex ?? (more.overflow ? 0 : undefined)}
      role={rest.role ?? (more.overflow && label ? 'region' : undefined)}
      aria-label={label}
    >
      {children}
    </div>
  );
}

// -------------------------------------------------------------------- popover

/**
 * A floating card anchored under a trigger. Fixed-positioned and clamped to the viewport, with its own scroll when the
 * viewport is short. Escape and outside presses close it and focus returns to the trigger (lib/layers).
 */
export function Popover({
  open,
  onClose,
  anchor,
  label,
  width,
  align = 'start',
  role = 'dialog',
  testid,
  children,
}: {
  open: boolean;
  onClose(): void;
  anchor: RefObject<HTMLElement | null>;
  label: string;
  /** CSS width; clamped to the viewport. */
  width: string;
  align?: 'start' | 'end';
  role?: 'dialog' | 'menu';
  testid?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  useLayer(open, onClose, ref, { anchor, dismissOnBlur: true });
  useLayoutEffect(() => {
    if (!open) return setPos(null);
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const w = el.offsetWidth;
      const left = Math.max(12, Math.min(align === 'end' ? a.right - w : a.left, vw - w - 12));
      const below = vh - a.bottom - 20;
      const above = a.top - 20;
      const up = below < 220 && above > below;
      setPos(up ? { left, bottom: vh - a.top + 8, maxHeight: above } : { left, top: a.bottom + 8, maxHeight: below });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, anchor, align]);
  if (!open) return null;
  // Tab stays inside a dialog popover (Escape leaves it); a menu handles its own keys
  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || role !== 'dialog') return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])].filter((el) => el.getClientRects().length);
    if (!items.length) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || cur === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      (firstFocusable(ref.current) ?? first).focus();
    }
  };
  // In a portal: scroll areas mask and clip their content, and a popover must never be clipped by the card it came from.
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      aria-modal={role === 'dialog' ? false : undefined}
      tabIndex={-1}
      data-testid={testid}
      data-layer="popover"
      onKeyDown={trap}
      className="layer anim-pop fixed z-[70] flex min-h-0 flex-col overflow-hidden outline-none"
      style={{ width, maxWidth: 'calc(100vw - 24px)', visibility: pos ? 'visible' : 'hidden', ...pos }}
    >
      <ScrollArea className="min-h-0 flex-1 p-4">{children}</ScrollArea>
    </div>,
    document.body,
  );
}

// ----------------------------------------------------------------------- tabs

/** WAI-ARIA tabs with automatic activation: arrows, Home and End move and select; only the selected tab is a tab stop. */
export function useTabs<T extends string>(ids: readonly T[], current: T, select: (id: T) => void) {
  const base = useId();
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const i = ids.indexOf(current);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % ids.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + ids.length) % ids.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    select(ids[next]);
    const list = e.currentTarget;
    requestAnimationFrame(() => list.querySelector<HTMLElement>(`[data-tab="${ids[next]}"]`)?.focus());
  };
  return {
    list: { role: 'tablist' as const, onKeyDown },
    tab: (id: T) => ({
      role: 'tab' as const,
      type: 'button' as const,
      id: `${base}-tab-${id}`,
      'data-tab': id,
      'aria-selected': id === current,
      'aria-controls': `${base}-panel-${id}`,
      tabIndex: id === current ? 0 : -1,
      onClick: () => select(id),
    }),
    panel: (id: T) => ({ role: 'tabpanel' as const, id: `${base}-panel-${id}`, 'aria-labelledby': `${base}-tab-${id}` }),
  };
}

// ----------------------------------------------------------------------- menu

export interface MenuEntry {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect(): void;
}

/** WAI-ARIA menu button: Enter/Space/ArrowDown open it, arrows move, Escape closes and returns focus, Tab closes. */
export function MenuButton({ label, entries, testid, className = 'btn btn-sm btn-ghost btn-icon' }: { label: string; entries: MenuEntry[]; testid?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Tab') return setOpen(false);
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    items[next]?.focus();
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid={testid}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
      >
        <Icon name="more" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={btn} label={label} width="13rem" align="end" role="menu" testid={testid ? `${testid}-menu` : undefined}>
        <div className="-m-2 flex flex-col" onKeyDown={onKeyDown}>
          {entries.map((it) => (
            <button
              key={it.id}
              type="button"
              role="menuitem"
              className={`menu-item ${it.danger ? 'is-danger' : ''}`}
              data-testid={testid ? `${testid}-${it.id}` : undefined}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.icon && <Icon name={it.icon} size={17} />}
              {it.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

// ------------------------------------------------------------------ utilities

/** True when the primary pointer is coarse (a touch screen), live. */
export function useCoarsePointer(): boolean {
  const q = '(pointer: coarse)';
  const [coarse, setCoarse] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setCoarse(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return coarse;
}

/** Two-step destructive action: the first press arms it for three seconds, the second one runs it. */
export function useConfirm(run: () => void): { armed: boolean; press(): void } {
  const [armed, setArmed] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return {
    armed,
    press: () => {
      clearTimeout(timer.current);
      if (armed) {
        setArmed(false);
        run();
      } else {
        setArmed(true);
        timer.current = window.setTimeout(() => setArmed(false), 3000);
      }
    },
  };
}
