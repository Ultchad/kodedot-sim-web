import { useI18n } from '../../i18n';
import { useLive } from '../../state/hooks';
import { useHost } from '../../state/host';

/** The latest things the Dot did with this object, newest last. Quiet (nothing drawn) until it did something. */
export function LiveLines({ id, max = 4, label }: { id: string; max?: number; label?: string }) {
  const { t, fmt } = useI18n();
  const { live } = useHost();
  const s = useLive(live, id);
  if (!s.entries.length) return null;
  const rows = s.entries.slice(-max);
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-live="polite" aria-label={label} data-testid="live-lines">
      {rows.map((e, i) => (
        <li key={`${e.at}-${i}`} className="live-line" data-tone={e.tone}>
          <span className="live-dot" data-tone={e.tone} aria-hidden />
          <span className="min-w-0 flex-1 break-words">
            {t(e.key, e.vars)}
            {e.count > 1 && <span className="ml-1 font-semibold text-ink2">×{fmt.number(e.count)}</span>}
          </span>
          <time className="shrink-0 text-[12px] tabular-nums text-ink2" dateTime={new Date(e.at).toISOString()}>
            {fmt.clock(e.at)}
          </time>
        </li>
      ))}
    </ul>
  );
}

/** A small status line with a coloured dot (connected, waiting, ...). */
export function StatusPill({ tone = 'info', children, testid }: { tone?: 'info' | 'ok' | 'bad'; children: React.ReactNode; testid?: string }) {
  return (
    <span className="pill !h-auto min-h-[var(--readout-h)] !whitespace-normal py-1" data-testid={testid} data-tone={tone}>
      <span className="live-dot" data-tone={tone} aria-hidden />
      {children}
    </span>
  );
}
