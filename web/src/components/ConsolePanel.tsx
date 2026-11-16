import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogLevel } from '../device/types';
import { useI18n } from '../i18n';
import { cleanLogLine, effectiveLevel } from '../lib/logline';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';
import { Icon } from './Glyphs';

const LEVEL_CLASS: Record<LogLevel, string> = { debug: 'text-dim', info: 'text-darktext', warn: 'text-primary', error: 'text-[#ff8a93]', input: 'text-[#7ee2a0]' };

/**
 * The console is a dark card; mono type is used only for the log lines.
 * Each line shows one compact time (the device's own when the firmware printed one) and the bare message, wrapped at
 * word boundaries; the full timestamp is the tooltip of the time and Copy keeps it.
 */
export function ConsolePanel({ onClose, closeLabel }: { onClose?: () => void; closeLabel?: string }) {
  const { t, fmt } = useI18n();
  const { device } = useHost();
  const raw = useObservable(device.log);
  const lines = useMemo(
    () =>
      raw.map((l) => {
        const c = cleanLogLine(l.text);
        return { id: l.id, ts: c.time ?? l.ts, level: effectiveLevel(l.level, c.level), text: c.text };
      }),
    [raw],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [seenCount, setSeenCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState('');
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick) {
      el.scrollTop = el.scrollHeight;
      setSeenCount(lines.length);
    }
  }, [lines, stick]);
  // keep the latest line in view when the card is resized or collapsed and reopened
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stick) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stick]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setStick(atBottom);
    if (atBottom) setSeenCount(lines.length);
  };

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    const out = lines.map((l) => `${new Date(l.ts).toISOString()} ${l.level.toUpperCase()} ${l.text}`).join('\n');
    try {
      await navigator.clipboard.writeText(out);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = out;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
  };

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    device.sendConsole(v);
    history.current.unshift(v);
    histPos.current = -1;
    setText('');
    setStick(true);
  };

  const fresh = Math.max(0, lines.length - seenCount);

  return (
    <section className="on-dark flex min-h-0 min-w-0 flex-1 flex-col rounded-3xl bg-dark text-darktext" aria-label={t('nav.console')} data-testid="console-panel">
      <div className="flex items-center gap-2 px-5 pb-2 pt-4">
        <h2 className="min-w-0 flex-1 truncate text-[20px]">{t('console.title')}</h2>
        <button type="button" className="btn btn-sm btn-dark" onClick={() => device.log.clear()} disabled={lines.length === 0} data-testid="console-clear">
          {t('console.clear')}
        </button>
        <button type="button" className="btn btn-sm btn-dark" onClick={() => void copy()} disabled={lines.length === 0} data-testid="console-copy">
          {copied ? <Icon name="check" size={16} /> : null}
          {t(copied ? 'console.copied' : 'console.copy')}
        </button>
        {onClose && (
          <button type="button" className="btn btn-sm btn-dark btn-icon" onClick={onClose} aria-label={closeLabel} title={closeLabel} data-testid="console-collapse">
            <Icon name="close" />
          </button>
        )}
        <span role="status" className="sr-only">
          {copied ? t('console.copied') : ''}
        </span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="scroll-thin absolute inset-0 overflow-y-auto overscroll-contain px-5 py-2 font-mono text-[12.5px] leading-[1.6]"
          role="log"
          aria-label={t('console.title')}
          tabIndex={0}
          data-arrow-keys
          data-testid="console-log"
        >
          {lines.length === 0 && <p className="m-0 font-sans text-[13.5px] leading-snug text-dim">{t('console.empty')}</p>}
          {lines.map((l) => (
            <div key={l.id} className="flex gap-2.5">
              <time className="shrink-0 tabular-nums text-dim" dateTime={new Date(l.ts).toISOString()} title={fmt.dateTimeFull(l.ts)}>
                {fmt.clock(l.ts)}
              </time>
              <span className={`min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${LEVEL_CLASS[l.level]}`} data-level={l.level}>
                {l.level === 'input' ? `› ${l.text}` : l.text}
              </span>
            </div>
          ))}
        </div>
        {!stick && (
          <button
            type="button"
            className="btn btn-sm btn-primary anim-rise absolute bottom-2 right-4"
            data-testid="console-latest"
            onClick={() => {
              setStick(true);
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            <Icon name="arrowDown" size={16} />
            {fresh > 0 ? t('console.paused', { count: fresh }) : t('console.resume')}
          </button>
        )}
      </div>
      <form
        className="flex items-center gap-2 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          className="field-input is-dark"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('console.input')}
          placeholder={t('console.placeholder')}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          data-testid="console-input"
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && history.current.length) {
              e.preventDefault();
              histPos.current = Math.min(history.current.length - 1, histPos.current + 1);
              setText(history.current[histPos.current]);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              histPos.current = Math.max(-1, histPos.current - 1);
              setText(histPos.current < 0 ? '' : history.current[histPos.current]);
            }
          }}
        />
        <button type="submit" className="btn btn-dark btn-icon" disabled={!text.trim()} aria-label={t('console.send')} title={t('console.send')} data-testid="console-send">
          <Icon name="send" />
        </button>
      </form>
    </section>
  );
}
