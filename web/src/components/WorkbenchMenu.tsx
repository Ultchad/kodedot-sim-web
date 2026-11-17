/**
 * The small menu of a thing on the Workbench's table: opened by a right click or a long press on it in the scene
 * (workbench/World.tsx puts it on the bus), closed by a choice, Escape, or a press anywhere else. For the Dot it offers
 * the ways of putting it down; for anything else, a quarter turn, a copy and removal. The same choices are in the
 * side panel's cards, which is where the keyboard reaches them.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useBenchState } from '../state/bench';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { DOT_ID, DOT_POSES, SD_ID, type DotPose } from '../workbench/layout';
import { Icon } from './Glyphs';

const POSE_KEY = { lying: 'wb.pose.lying', standing: 'wb.pose.standing', side: 'wb.pose.side' } as const;
const POSE_HINT = { lying: 'wb.pose.lying.hint', standing: 'wb.pose.standing.hint', side: 'wb.pose.side.hint' } as const;

/** The ways the Dot can be put down, as pills; the one in force is pressed. */
export function PosePicker({ onPicked, autoFocus = false }: { onPicked?: () => void; autoFocus?: boolean }) {
  const { t } = useI18n();
  const host = useHost();
  const pose = useBenchState(host.bench).dotPose;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('wb.pose')} data-testid="dot-pose">
      {DOT_POSES.map((p: DotPose, i) => (
        <button
          key={p}
          type="button"
          className="chip"
          aria-pressed={pose === p}
          title={t(POSE_HINT[p])}
          autoFocus={autoFocus && i === 0}
          onClick={() => {
            host.parts.setDotPose(p);
            onPicked?.();
          }}
          data-testid={`dot-pose-${p}`}
        >
          {t(POSE_KEY[p])}
        </button>
      ))}
    </div>
  );
}

export function WorkbenchMenu() {
  const { t } = useI18n();
  const host = useHost();
  const { bus, bench, select } = host;
  const menu = useSyncExternalStore(bus.onMenu, bus.getMenu);
  const state = useBenchState(bench);
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  // inside the stage, beside the pointer, never over its edge
  useLayoutEffect(() => {
    const el = box.current, stage = el?.offsetParent as HTMLElement | null;
    if (!menu || !el || !stage) return setAt(null);
    const s = stage.getBoundingClientRect();
    const left = Math.max(8, Math.min(menu.x - s.left + 6, s.width - el.offsetWidth - 8));
    const top = Math.max(8, Math.min(menu.y - s.top + 6, s.height - el.offsetHeight - 8));
    setAt({ left, top });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const close = () => bus.openMenu(null);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('blur', close);
    };
  }, [menu, bus]);
  if (!menu) return null;
  const close = () => bus.openMenu(null);
  const isDot = menu.target === DOT_ID;
  const obj = isDot ? undefined : state.objects.find((o) => o.id === menu.target);
  if (!isDot && !obj) return null;
  const act = (fn: () => void) => () => {
    bench.checkpoint();
    fn();
    close();
  };
  return (
    <div
      ref={box}
      className="card anim-fade absolute z-20 flex w-max max-w-[min(92%,22rem)] flex-col gap-2.5 !rounded-[22px] !p-3"
      style={at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' }}
      role="dialog"
      aria-label={isDot ? t('wb.pose') : t('wb.menu')}
      data-testid="wb-menu"
      data-target={isDot ? 'dot' : menu.target}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isDot ? (
        <>
          <h3 className="tag m-0">{t('wb.pose')}</h3>
          <PosePicker onPicked={close} autoFocus />
        </>
      ) : (
        <>
          <h3 className="tag m-0 max-w-[16rem] truncate">{obj!.name}</h3>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="chip" autoFocus onClick={act(() => bench.rotate([obj!.id]))} data-testid="wb-menu-turn">
              <Icon name="rotate" size={16} />
              {t('wb.menu.turn')}
            </button>
            <button
              type="button"
              className="chip"
              onClick={act(() => {
                const copy = bench.duplicate(obj!.id);
                if (copy) select.only(copy.id);
              })}
              data-testid="wb-menu-copy"
            >
              <Icon name="copy" size={16} />
              {t('bench.duplicate')}
            </button>
            <button type="button" className="chip" onClick={act(() => bench.remove(obj!.id))} data-testid="wb-menu-delete">
              <Icon name="trash" size={16} />
              {t('bench.delete')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Things the menu is not for: the card (it has its own panel). */
export const menuTarget = (id: string): boolean => id !== SD_ID;
