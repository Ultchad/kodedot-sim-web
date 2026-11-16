import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { useObservable } from '../state/hooks';

const LEVEL_CLASS: Record<string, string> = { debug: 'text-ink3', info: 'text-ink', warn: 'text-accent', error: 'text-bad', input: 'text-ok' };

export function ConsolePanel() {
  const { t, fmt } = useI18n();
  const { device } = useHost();
  const lines = useObservable(device.log);
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
    const out = lines.map((l) => `${fmt.time(l.ts)} ${l.level.toUpperCase()} ${l.text}`).join('\n');
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
    <div className="flex min-h-0 flex-1 flex-col" data-testid="console-panel">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="eyebrow flex-1">{t('console.title')}</span>
        <button type="button" className="btn btn-ghost" onClick={() => device.log.clear()} disabled={lines.length === 0}>
          {t('console.clear')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void copy()} disabled={lines.length === 0}>
          {t('console.copy')}
        </button>
        <span role="status" className="sr-only">
          {copied ? t('console.copied') : ''}
        </span>
        {copied && <span aria-hidden className="font-mono text-[11px] text-ok">{t('console.copied')}</span>}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="scroll-thin absolute inset-0 overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-[1.55]" role="log" aria-label={t('console.title')} tabIndex={0} data-testid="console-log">
          {lines.length === 0 && <div className="text-ink3">{t('console.empty')}</div>}
          {lines.map((l) => (
            <div key={l.id} className="flex gap-2 break-words">
              <span className="shrink-0 text-ink3">{fmt.time(l.ts)}</span>
              <span className={`min-w-0 whitespace-pre-wrap break-all ${LEVEL_CLASS[l.level]}`}>{l.text}</span>
            </div>
          ))}
        </div>
        {!stick && (
          <button
            type="button"
            className="btn absolute bottom-2 right-3 border-accent bg-panel shadow-md"
            onClick={() => {
              setStick(true);
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
          >
            {fresh > 0 ? t('console.paused', { count: fresh }) : t('console.resume')}
          </button>
        )}
      </div>
      <form
        className="flex items-center gap-2 border-t border-line px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span aria-hidden className="font-mono text-accent">
          &gt;
        </span>
        <input
          className="field-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('console.input')}
          placeholder={t('console.placeholder')}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
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
      </form>
    </div>
  );
}
