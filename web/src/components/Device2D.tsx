import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyEvent, type PointerEvent as RPointerEvent } from 'react';
import type { ButtonId } from '../device/types';
import { useI18n, type TKey } from '../i18n';
import { pointerToScreen } from '../lib/coords';
import { SPEC, dpadDirection, inflate, metrics, MIN_HIT_PX } from '../lib/geometry';
import { KEY_HINT } from '../lib/keys';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';

const M = metrics(SPEC);
const IMG_SRC = '/device/kode-dot.png';

export const BTN_LABEL: Record<ButtonId, TKey> = {
  top: 'device.btn.top',
  bottom: 'device.btn.bottom',
  up: 'device.btn.up',
  down: 'device.btn.down',
  left: 'device.btn.left',
  right: 'device.btn.right',
};

/** Brightness factor for a backlight percentage (perceptual-ish curve). */
export const backlightFactor = (pct: number) => Math.pow(Math.max(0, Math.min(100, pct)) / 100, 0.85);

interface Props {
  /** Integer zoom for pixel-exact work, or 'fit' to fill the available box. */
  zoom: number | 'fit';
  /** Crop the render's transparent margin so the body touches the edges (phone). */
  crop?: boolean;
}

export function Device2D({ zoom, crop = false }: Props) {
  const { t } = useI18n();
  const { device, input, painter } = useHost();
  const status = useObservable(device.status);
  const backlight = useObservable(device.backlight);
  const panelOn = useObservable(device.panelOn);
  const led = useObservable(device.led);
  const pressed = useObservable(input.pressed);

  const outerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const target = crop ? { x: M.bodyPx.x, y: M.bodyPx.y, w: M.bodyPx.w, h: M.bodyPx.h } : { x: 0, y: 0, w: M.imgW, h: M.imgH };
  const scale = zoom === 'fit' ? Math.max(0.05, Math.min(box.w / target.w, box.h / target.h)) : zoom;
  const px = (v: number) => v * scale; // device px -> CSS px

  // mount the shared screen canvas into the glass
  const glassRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const g = glassRef.current;
    if (!g) return;
    const c = painter.canvas;
    c.style.cssText = 'display:block;width:100%;height:100%';
    g.prepend(c);
    return () => {
      if (c.parentNode === g) g.removeChild(c);
    };
  }, [painter]);
  useEffect(() => {
    painter.canvas.style.imageRendering = scale >= 1 ? 'pixelated' : 'auto';
  }, [painter, scale]);

  // glass = touch input (first pointer only)
  const glassDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = pointerToScreen(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    if (input.touchDown(e.pointerId, p.x, p.y)) e.currentTarget.setPointerCapture(e.pointerId);
  };
  const glassMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pointerToScreen(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    input.touchMove(e.pointerId, p.x, p.y);
  };
  const glassUp = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pointerToScreen(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    input.touchUp(e.pointerId, p.x, p.y);
  };

  const ledOn = led.r + led.g + led.b > 0;
  const ledRgb = `${led.r}, ${led.g}, ${led.b}`;
  const cornerR = px(M.screenMm.r * M.ppm);

  return (
    <div ref={outerRef} className="device-surface relative flex min-h-0 min-w-0 flex-1 overflow-auto scroll-thin" data-testid="device-2d">
      <div className="relative m-auto shrink-0" style={{ width: px(target.w), height: px(target.h) }} data-testid="device-2d-body">
        <img
          src={IMG_SRC}
          alt=""
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{ left: -px(target.x), top: -px(target.y), width: px(M.imgW), height: px(M.imgH) }}
        />

        {/* glass */}
        <div
          ref={glassRef}
          role="img"
          aria-label={t('device.screen')}
          data-testid="glass"
          className="absolute overflow-hidden bg-black"
          style={{ left: px(M.screenPx.x - target.x), top: px(M.screenPx.y - target.y), width: px(M.screenPx.w), height: px(M.screenPx.h), borderRadius: cornerR, touchAction: 'none' }}
          onPointerDown={glassDown}
          onPointerMove={glassMove}
          onPointerUp={glassUp}
          onPointerCancel={glassUp}
          onLostPointerCapture={glassUp}
        >
          {/* backlight / panel off: a black veil (no CSS filter: it tiles badly on scaled canvases) */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: panelOn ? 1 - backlightFactor(backlight) : 1 }} />
          {(status === 'idle' || status === 'crashed') && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 px-4 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-white/70">
              {t(status === 'idle' ? 'device.overlay.idle' : 'device.overlay.crashed')}
            </div>
          )}
        </div>

        {/* LED light guide */}
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            left: px(M.led.cx - target.x - M.led.w * 0.7),
            top: px(M.led.cy - target.y - M.led.h * 0.7),
            width: px(M.led.w * 1.4),
            height: px(M.led.h * 1.4),
            opacity: ledOn ? 1 : 0,
            background: `radial-gradient(circle, rgba(${ledRgb},0.95) 0%, rgba(${ledRgb},0.55) 30%, rgba(${ledRgb},0) 70%)`,
            mixBlendMode: 'normal',
          }}
        />

        <RoundButton id="top" cx={M.buttons.top.cx - target.x} cy={M.buttons.top.cy - target.y} d={M.buttons.top.d} scale={scale} pressed={pressed.has('top')} />
        <RoundButton id="bottom" cx={M.buttons.bottom.cx - target.x} cy={M.buttons.bottom.cy - target.y} d={M.buttons.bottom.d} scale={scale} pressed={pressed.has('bottom')} />
        <DPad cx={M.dpad.cx - target.x} cy={M.dpad.cy - target.y} scale={scale} pressed={pressed} />
      </div>
    </div>
  );
}

function RoundButton({ id, cx, cy, d, scale, pressed }: { id: ButtonId; cx: number; cy: number; d: number; scale: number; pressed: boolean }) {
  const { t } = useI18n();
  const { input } = useHost();
  const src = `p:${id}`;
  const hit = Math.max(d * scale, MIN_HIT_PX);
  const visible = d * scale;
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    input.press(id, `${src}:${e.pointerId}`);
  };
  const up = (e: RPointerEvent<HTMLButtonElement>) => input.release(id, `${src}:${e.pointerId}`);
  const kd = (e: RKeyEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.press(id, `${src}:kbd`);
    }
  };
  const ku = (e: RKeyEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') input.release(id, `${src}:kbd`);
  };
  return (
    <button
      type="button"
      data-button={id}
      data-pressed={pressed}
      aria-label={t(BTN_LABEL[id])}
      aria-pressed={pressed}
      aria-keyshortcuts={KEY_HINT[id]}
      title={`${t(BTN_LABEL[id])} (${KEY_HINT[id]})`}
      className="absolute rounded-full bg-transparent p-0"
      style={{ left: cx * scale - hit / 2, top: cy * scale - hit / 2, width: hit, height: hit, touchAction: 'none' }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onKeyDown={kd}
      onKeyUp={ku}
      onBlur={() => input.releaseSource(`${src}:kbd`)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute rounded-full transition-[transform,box-shadow,background] duration-75"
        style={{
          left: (hit - visible) / 2,
          top: (hit - visible) / 2,
          width: visible,
          height: visible,
          transform: pressed ? 'scale(0.94)' : 'none',
          background: pressed ? 'radial-gradient(circle, rgba(0,0,0,0.35), rgba(0,0,0,0.12) 70%)' : 'transparent',
          boxShadow: pressed ? 'inset 0 4px 10px rgba(0,0,0,0.65), 0 0 0 2px var(--accent)' : 'none',
        }}
      />
    </button>
  );
}

type Dir = Extract<ButtonId, 'up' | 'down' | 'left' | 'right'>;

function DPad({ cx, cy, scale, pressed }: { cx: number; cy: number; scale: number; pressed: ReadonlySet<ButtonId> }) {
  const { t } = useI18n();
  const { input } = useHost();
  const span = SPEC.dpad_px.span;
  const arm = inflate(SPEC.dpad_px.arm_w, scale);
  const cur = useRef<Map<number, Dir | null>>(new Map());

  const setDir = (pointerId: number, next: Dir | null) => {
    const prev = cur.current.get(pointerId) ?? null;
    if (prev === next) return;
    if (prev) input.release(prev, `p:dpad:${pointerId}`);
    if (next) input.press(next, `p:dpad:${pointerId}`);
    cur.current.set(pointerId, next);
  };
  const dirAt = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / scale;
    const dy = (e.clientY - (r.top + r.height / 2)) / scale;
    return dpadDirection(dx, dy, span, arm);
  };

  const box = Math.max(span * scale, 0);
  const arms: { id: Dir; style: CSSProperties }[] = [
    { id: 'up', style: { left: (span / 2 - arm / 2) * scale, top: 0, width: arm * scale, height: (span / 2) * scale } },
    { id: 'down', style: { left: (span / 2 - arm / 2) * scale, top: (span / 2) * scale, width: arm * scale, height: (span / 2) * scale } },
    { id: 'left', style: { left: 0, top: (span / 2 - arm / 2) * scale, width: (span / 2) * scale, height: arm * scale } },
    { id: 'right', style: { left: (span / 2) * scale, top: (span / 2 - arm / 2) * scale, width: (span / 2) * scale, height: arm * scale } },
  ];

  return (
    <div
      data-testid="dpad"
      className="absolute"
      style={{ left: cx * scale - box / 2, top: cy * scale - box / 2, width: box, height: box, touchAction: 'none' }}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDir(e.pointerId, dirAt(e));
      }}
      onPointerMove={(e) => {
        if (cur.current.has(e.pointerId)) setDir(e.pointerId, dirAt(e));
      }}
      onPointerUp={(e) => {
        setDir(e.pointerId, null);
        cur.current.delete(e.pointerId);
      }}
      onPointerCancel={(e) => {
        setDir(e.pointerId, null);
        cur.current.delete(e.pointerId);
      }}
      onLostPointerCapture={(e) => {
        setDir(e.pointerId, null);
        cur.current.delete(e.pointerId);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {arms.map(({ id, style }) => {
        const on = pressed.has(id);
        return (
          <button
            key={id}
            type="button"
            data-button={id}
            data-pressed={on}
            aria-label={t(BTN_LABEL[id])}
            aria-pressed={on}
            aria-keyshortcuts={`Arrow${id[0].toUpperCase()}${id.slice(1)}`}
            title={`${t(BTN_LABEL[id])} (${KEY_HINT[id]})`}
            className="pointer-events-none absolute rounded-md bg-transparent p-0"
            style={{ ...style, background: on ? 'rgba(255,255,255,0.16)' : 'transparent', boxShadow: on ? 'inset 0 3px 8px rgba(0,0,0,0.6), 0 0 0 2px var(--accent)' : 'none' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                input.press(id, 'p:dpad:kbd');
              }
            }}
            onKeyUp={(e) => {
              if (e.key === 'Enter' || e.key === ' ') input.release(id, 'p:dpad:kbd');
            }}
            onBlur={() => input.release(id, 'p:dpad:kbd')}
          />
        );
      })}
    </div>
  );
}
