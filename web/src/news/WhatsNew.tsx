import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '../components/Glyphs';
import { openGuide, useGuideRoute } from '../guide/store';
import { useI18n } from '../i18n';
import { openLayerCount, useLayer } from '../lib/layers';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { mayAppear, news, useNews, type NewsView } from './store';
import { NEWS_STRINGS, entryDate } from './strings';

/** How long the page must have been quiet (the Dot started, nothing loading) before the card comes in by itself. */
export const SETTLE_MS = 1400;

/**
 * Shows the "What's new" card: by itself once per update for a returning visitor (after the page has settled, never
 * over the guide or an open menu), or when asked for (WhatsNewButton). It is a small card in a corner, not a modal:
 * the Dot keeps running and the rest of the page stays usable; a press anywhere outside closes it.
 */
export function WhatsNewHost() {
  const view = useNews();
  const { device, launching } = useHost();
  const status = useObservable(device.status);
  const guideOpen = useGuideRoute().open;
  const settled = !launching && status !== 'booting';
  const [ready, setReady] = useState(false);
  const due = !!view && !view.manual;
  useEffect(() => {
    if (!due || !settled || guideOpen) return setReady(false);
    let id: ReturnType<typeof setTimeout>;
    const attempt = () => {
      if (mayAppear({ settled: true, guideOpen: false, layersOpen: openLayerCount() })) setReady(true);
      else id = setTimeout(attempt, SETTLE_MS); // a menu or the phone's panel is open: later
    };
    id = setTimeout(attempt, SETTLE_MS);
    return () => clearTimeout(id);
  }, [due, settled, guideOpen]);
  if (!view || !(view.manual || ready)) return null;
  return <WhatsNewCard key={view.entry.id} view={view} />;
}

function WhatsNewCard({ view }: { view: NewsView }) {
  const { locale } = useI18n();
  const { layout } = useHost();
  const s = NEWS_STRINGS[locale];
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const close = () => news.dismiss();
  // Escape, a press outside, and focus back to where it was (lib/layers); focus goes to the card itself, so a screen
  // reader announces its name and the next Tab reaches its first control
  useLayer(true, close, ref, { autoFocus: false });
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  const { entry, earlier } = view;
  const date = entryDate(entry.id, locale);
  const guide = entry.guide;
  // desk: the bottom right corner, above the status row. phone: a card across the bottom, above the home indicator
  const place =
    layout === 'phone-portrait'
      ? 'inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] max-h-[min(34rem,calc(100dvh-96px))]'
      : layout === 'phone-landscape'
        ? 'right-[max(12px,env(safe-area-inset-right))] bottom-[max(12px,env(safe-area-inset-bottom))] w-[22rem] max-w-[calc(100vw-24px)] max-h-[calc(100dvh-24px)]'
        : 'right-4 bottom-[68px] w-[23rem] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-148px)]';
  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      lang={locale}
      data-testid="whats-new"
      data-entry={entry.id}
      data-layer="news"
      className={`layer anim-rise fixed z-[75] flex min-h-0 flex-col overflow-hidden outline-none ${place}`}
    >
      <header className="flex shrink-0 items-center gap-2.5 pl-5 pr-2.5 pt-2.5">
        <span className="inline-flex h-7 items-center rounded-full bg-primary px-3 text-[12.5px] font-bold leading-none text-primaryink">{s.label}</span>
        {date && (
          <time dateTime={entry.id.slice(0, 10)} className="min-w-0 truncate text-[13px] text-ink2">
            {date}
          </time>
        )}
        <span className="min-w-0 flex-1" />
        <button type="button" className="btn btn-sm btn-icon btn-ghost shrink-0" onClick={close} aria-label={s.close} title={s.close} data-testid="whats-new-close">
          <Icon name="close" size={17} />
        </button>
      </header>
      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto px-5 pb-5 pt-2">
        <h2 id={titleId} className="text-[20px] leading-[1.2] [text-wrap:balance]">
          {entry.title[locale]}
        </h2>
        <ul id={bodyId} className="m-0 flex list-none flex-col gap-2 p-0 text-[14.5px] leading-snug">
          {entry.points[locale].map((p) => (
            <li key={p} className="flex gap-2.5">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{p}</span>
            </li>
          ))}
        </ul>
        {earlier.length > 0 && (
          <div className="inner flex flex-col gap-1.5 px-3.5 py-3" data-testid="whats-new-earlier">
            <span className="tag">{s.earlier}</span>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px] leading-snug text-ink2">
              {earlier.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{e.title[locale]}</span>
                  <time dateTime={e.id.slice(0, 10)} className="shrink-0 whitespace-nowrap text-[12.5px] text-ink3">
                    {entryDate(e.id, locale)}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {guide && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="whats-new-guide"
              onClick={() => {
                close();
                openGuide(guide);
              }}
            >
              {s.more}
            </button>
          )}
          <button type="button" className="btn btn-sm btn-primary" onClick={close} data-testid="whats-new-dismiss">
            {s.gotIt}
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Reopens the latest notes on demand. `before` runs first (the popover it sits in closes and hands focus back to its
 * own button), then the card opens, so closing the card returns focus to something that is still on the page.
 */
export function WhatsNewButton({ before, className = '' }: { before?(): void; className?: string }) {
  const { locale } = useI18n();
  const open = !!useNews();
  if (!news.hasNotes) return null;
  return (
    <button
      type="button"
      className={`btn btn-sm ${className}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-testid="whats-new-open"
      onClick={() => {
        before?.();
        setTimeout(() => news.open(), 0);
      }}
    >
      {NEWS_STRINGS[locale].label}
    </button>
  );
}
