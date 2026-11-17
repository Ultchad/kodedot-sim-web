import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Glyphs';
import { ScrollArea } from '../components/ui';
import { useI18n } from '../i18n';
import type { Locale } from '../i18n/core';
import { KEY_HINT } from '../lib/keys';
import { firstFocusable, useLayer } from '../lib/layers';
import { isPhone } from '../lib/layout';
import { useHost } from '../state/host';
import { BUNDLED_APPS } from './apps';
import { CAPABILITIES } from './capabilities';
import { fillVars, guideText, guideVars, type GuideKey } from './content';
import { Figure } from './figures';
import './guide.css';
import { Inline } from './inline';
import { guideHash, SECTION_IDS, type SectionId } from './route';
import { SECTIONS, sectionOf, type Block, type Step } from './sections';
import { BOARD_NAMES, SKETCH_FAMILIES, SKETCH_SUPPORTED, SKETCH_UNSUPPORTED, sketchText, type SketchItem } from './sketchData';
import { closeGuide, openGuide, takeOpener, useGuideRoute } from './store';

type Tx = (key: GuideKey, extra?: Record<string, string>) => string;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Commands to copy. A line that starts with # is what the tool answers, not something to type. */
function Code({ lines }: { lines: readonly string[] }) {
  const vars = guideVars();
  return (
    <pre className="guide-code" tabIndex={0}>
      {lines.map((l, i) => (
        <span key={i} className={l.startsWith('#') ? 'is-comment' : undefined}>
          {fillVars(l, vars)}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

function Steps({ steps, text }: { steps: readonly Step[]; text: (k: GuideKey) => ReactNode }) {
  return (
    <ol className="guide-steps">
      {steps.map((s) => {
        const k = typeof s === 'string' ? s : s.k;
        return (
          <li key={k}>
            {text(k)}
            {typeof s !== 'string' && <Code lines={s.code} />}
          </li>
        );
      })}
    </ol>
  );
}

/** The keys of the Dot's buttons, from the page's own key map. */
function KeysTable({ tx }: { tx: Tx }) {
  const rows: [ReactNode, string][] = [
    [<kbd key="t">{KEY_HINT.top}</kbd>, tx('dot.key.top')],
    [<kbd key="b">{KEY_HINT.bottom}</kbd>, tx('dot.key.bottom')],
    [
      <span key="d" className="inline-flex flex-wrap gap-1">
        {(['left', 'up', 'down', 'right'] as const).map((d) => (
          <kbd key={d}>{KEY_HINT[d]}</kbd>
        ))}
      </span>,
      tx('dot.key.dpad'),
    ],
  ];
  return (
    <ul className="guide-rows" data-testid="guide-keys">
      {rows.map(([keys, what], i) => (
        <li key={i}>
          <span className="row-name">{keys}</span>
          <span>{what}</span>
        </li>
      ))}
      <li>
        <span className="row-name">{tx('dot.key.screen')}</span>
        <span>{tx('dot.key.screen.how')}</span>
      </li>
    </ul>
  );
}

function AppsTable({ tx }: { tx: Tx }) {
  return (
    <ul className="guide-rows" data-testid="guide-apps">
      {BUNDLED_APPS.map((a) => (
        <li key={a.id} data-app={a.id}>
          <span className="row-name">{a.name}</span>
          <span>{tx(a.text)}</span>
          <span className="row-sub">
            {tx('ui.source')}:{' '}
            <a href={a.source.url} target="_blank" rel="noreferrer noopener">
              {tx(a.source.label).replace(/`/g, '')}
              <span className="sr-only"> ({tx('ui.opensNew')})</span>
            </a>
          </span>
        </li>
      ))}
    </ul>
  );
}

function BoardsTable({ tx }: { tx: Tx }) {
  return (
    <ul className="guide-rows" data-testid="guide-boards">
      {SKETCH_FAMILIES.map((f) => (
        <li key={f.family}>
          <span className="row-name">{tx(`sk.family.${f.family}` as GuideKey)}</span>
          <span>{f.boards.map((b) => BOARD_NAMES[b] ?? b).join(', ')}</span>
        </li>
      ))}
    </ul>
  );
}

function SupportLists({ tx, locale }: { tx: Tx; locale: Locale }) {
  const list = (items: readonly SketchItem[], testid: string) => (
    <ul className="guide-list" data-testid={testid}>
      {items.map((x) => (
        <li key={x.id} data-item={x.id}>
          {sketchText(x, locale)}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <h3>{tx('sk.yes.h')}</h3>
      {list(SKETCH_SUPPORTED, 'guide-supported')}
      <h3>{tx('sk.no.h')}</h3>
      {list(SKETCH_UNSUPPORTED, 'guide-unsupported')}
      <h3>{tx('sk.notes.h')}</h3>
      <ul className="guide-rows" data-testid="guide-family-notes">
        {SKETCH_FAMILIES.filter((f) => f.notes.length).map((f) => (
          <li key={f.family}>
            <span className="row-name">{tx(`sk.family.${f.family}` as GuideKey)}</span>
            <span className="flex flex-col gap-2">
              {f.notes.map((n) => (
                <span key={n.id} data-item={n.id}>
                  {sketchText(n, locale)}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

function CapabilityTable({ tx, text }: { tx: Tx; text: (k: GuideKey) => ReactNode }) {
  const label = { works: tx('sim.status.works'), partial: tx('sim.status.partial'), none: tx('sim.status.none') };
  return (
    <table className="guide-table" data-testid="guide-capabilities">
      <thead>
        <tr>
          <th scope="col">{tx('sim.col.area')}</th>
          <th scope="col">{tx('sim.col.state')}</th>
          <th scope="col">{tx('sim.col.detail')}</th>
        </tr>
      </thead>
      <tbody>
        {CAPABILITIES.map((c) => (
          <tr key={c.id} data-area={c.id} data-state={c.state}>
            <td>{tx(c.area)}</td>
            <td className="state">
              <span className="guide-state" data-state={c.state}>
                {label[c.state]}
              </span>
            </td>
            <td>{text(c.detail)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BlockView({ b, tx, text, locale, labels }: { b: Block; tx: Tx; text: (k: GuideKey) => ReactNode; locale: Locale; labels: { near: string; away: string } }) {
  switch (b.t) {
    case 'p':
      return <p>{text(b.k)}</p>;
    case 'h':
      return <h3>{tx(b.k)}</h3>;
    case 'note':
      return <p className="guide-note">{text(b.k)}</p>;
    case 'list':
      return (
        <ul className="guide-list">
          {b.k.map((k) => (
            <li key={k}>{text(k)}</li>
          ))}
        </ul>
      );
    case 'steps':
      return <Steps steps={b.k} text={text} />;
    case 'code':
      return <Code lines={b.lines} />;
    case 'fig':
      return (
        <figure className="guide-figure" data-fig={b.fig}>
          <Figure id={b.fig} near={labels.near} away={labels.away} />
          <figcaption>{tx(b.cap)}</figcaption>
        </figure>
      );
    case 'keys':
      return <KeysTable tx={tx} />;
    case 'apps':
      return <AppsTable tx={tx} />;
    case 'boards':
      return <BoardsTable tx={tx} />;
    case 'support':
      return <SupportLists tx={tx} locale={locale} />;
    case 'capabilities':
      return <CapabilityTable tx={tx} text={text} />;
  }
}

function GuideDialog({ section }: { section: SectionId }) {
  const { t, locale } = useI18n();
  const { layout } = useHost();
  const compact = isPhone(layout);
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const tx: Tx = (key, extra) => guideText(locale, key, extra);
  const text = (key: GuideKey) => <Inline text={tx(key)} onSection={(id) => openGuide(id)} newTab={tx('ui.opensNew')} />;
  const cur = sectionOf(section);
  const index = SECTION_IDS.indexOf(cur.id);
  const prev = SECTIONS[index - 1];
  const next = SECTIONS[index + 1];

  // The page under the guide keeps running but takes no input and is not read out while the guide is open.
  // Declared before useLayer: on closing, the page is usable again before focus is handed back to it.
  useEffect(() => {
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => root?.removeAttribute('inert');
  }, []);
  useLayer(true, closeGuide, dialog, { autoFocus: false, dismissOutside: false });
  // Closing gives focus back to what opened the guide; opened from a link (nothing was pressed), to the guide's own button.
  useEffect(
    () => () => {
      const from = takeOpener();
      if (from?.isConnected && from.getClientRects().length) return from.focus({ preventScroll: true });
      const a = document.activeElement;
      if (a && a !== document.body) return;
      for (const el of document.querySelectorAll<HTMLElement>('[data-guide-entry]')) {
        if (el.getClientRects().length) return el.focus({ preventScroll: true });
      }
    },
    [],
  );
  // every section starts at its top, with its title focused: it is read out, and Tab goes on into the text
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
    setCopied(false);
  }, [cur.id]);

  const trap = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // nothing typed here reaches the Dot's buttons or the table's shortcuts
    if (e.key !== 'Tab') return;
    const items = [...(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((el) => el.getClientRects().length);
    if (!items.length) return e.preventDefault();
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === dialog.current || at === heading.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      (firstFocusable(dialog.current) ?? first).focus();
    }
  };

  const copyLink = async () => {
    const url = `${location.origin}${location.pathname}${guideHash(cur.id)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // no clipboard permission: a field with the link selected, copied the old way
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.setAttribute('readonly', '');
      ta.className = 'sr-only';
      dialog.current?.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const navItem = (s: (typeof SECTIONS)[number], i: number) => (
    <li key={s.id}>
      <a
        className="guide-nav-item"
        href={guideHash(s.id)}
        aria-current={s.id === cur.id ? 'page' : undefined}
        data-testid={`guide-nav-${s.id}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          openGuide(s.id);
        }}
      >
        <span className="num" aria-hidden>
          {i + 1}
        </span>
        <span className="min-w-0">{tx(s.title)}</span>
      </a>
    </li>
  );

  return (
    <div className={`fixed inset-0 z-[75] flex justify-center ${compact ? '' : 'p-3 sm:p-4'}`} data-layer="guide" data-testid="guide">
      <div aria-hidden className="anim-fade absolute inset-0" style={{ background: 'var(--scrim)' }} onPointerDown={closeGuide} data-testid="guide-scrim" />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-own-keys
        data-section={cur.id}
        data-testid="guide-dialog"
        onKeyDown={trap}
        onKeyUp={(e) => e.stopPropagation()}
        className={`layer anim-pop relative flex min-h-0 w-full max-w-[68rem] flex-col overflow-hidden outline-none ${compact ? '!rounded-none' : ''}`}
        style={compact ? { paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' } : undefined}
      >
        <header className={`flex shrink-0 items-center gap-3 ${compact ? 'px-4 pb-2 pt-3' : 'px-5 pb-3 pt-4'}`}>
          <span className="icon-tile bg-primary !text-primaryink" style={{ width: 36, height: 36 }} aria-hidden>
            <Icon name="help" size={20} />
          </span>
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-[24px] leading-tight">
            {tx('ui.title')}
          </h2>
          <button type="button" className="btn btn-icon" onClick={closeGuide} aria-label={tx('ui.close')} title={tx('ui.close')} data-testid="guide-close">
            <Icon name="close" />
          </button>
        </header>

        {compact && (
          <div className="shrink-0 px-4 pb-2">
            <select className="field-input w-full" aria-label={tx('ui.section')} value={cur.id} onChange={(e) => openGuide(e.target.value as SectionId)} data-testid="guide-select">
              {SECTIONS.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {tx(s.title)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {!compact && (
            <nav aria-label={tx('ui.sections')} className="flex w-[15.5rem] shrink-0 flex-col pb-4 pl-4" data-testid="guide-nav">
              <ScrollArea className="min-h-0 flex-1 pr-2">
                <ol className="m-0 flex list-none flex-col gap-1 p-0">{SECTIONS.map(navItem)}</ol>
              </ScrollArea>
            </nav>
          )}
          <ScrollArea innerRef={scroller} className={`min-h-0 min-w-0 flex-1 [container:guide/inline-size] ${compact ? 'px-4 pb-5 pt-2' : 'px-6 pb-6 pt-1'}`} label={tx(cur.title)} data-testid="guide-scroll">
            <article className="guide-prose" data-testid="guide-section">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <h2 ref={heading} tabIndex={-1} className="min-w-0 flex-1 basis-[14rem] text-[28px] leading-[1.15] outline-none" data-testid="guide-heading">
                  {tx(cur.title)}
                </h2>
                <button type="button" className="btn btn-sm shrink-0" onClick={() => void copyLink()} title={tx('ui.copyLink.hint')} data-testid="guide-copy-link">
                  <Icon name={copied ? 'check' : 'link'} size={16} />
                  <span aria-live="polite">{tx(copied ? 'ui.copied' : 'ui.copyLink')}</span>
                </button>
              </div>
              {cur.blocks.map((b, i) => (
                <BlockView key={`${cur.id}-${i}`} b={b} tx={tx} text={text} locale={locale} labels={{ near: t('presence.near'), away: t('presence.away') }} />
              ))}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                {prev ? (
                  <button type="button" className="btn btn-sm btn-wrap" onClick={() => openGuide(prev.id)} data-testid="guide-prev">
                    <Icon name="chevronLeft" size={16} />
                    <span className="min-w-0 text-left">
                      <span className="sr-only">{tx('ui.prev')}: </span>
                      {tx(prev.title)}
                    </span>
                  </button>
                ) : (
                  <span />
                )}
                {next && (
                  <button type="button" className="btn btn-sm btn-primary btn-wrap" onClick={() => openGuide(next.id)} data-testid="guide-next">
                    <span className="min-w-0 text-left">
                      <span className="sr-only">{tx('ui.next')}: </span>
                      {tx(next.title)}
                    </span>
                    <Icon name="chevronRight" size={16} />
                  </button>
                )}
              </div>
            </article>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

/** The guide: a dialog over the page, one section at a time. Loaded the first time it is opened. */
export default function Guide() {
  const route = useGuideRoute();
  if (!route.open) return null;
  return createPortal(<GuideDialog section={route.section} />, document.body);
}
