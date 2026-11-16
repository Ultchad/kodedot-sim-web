import { useI18n } from '../i18n';
import { useHost } from '../state/host';

export function NoticeBanner() {
  const { t } = useI18n();
  const { notice, dismissNotice } = useHost();
  if (!notice) return null;
  const err = notice.kind === 'error';
  return (
    <div
      role={err ? 'alert' : 'status'}
      data-testid="notice"
      data-kind={notice.kind}
      className={`pointer-events-auto fixed left-1/2 z-50 flex w-[min(92vw,38rem)] -translate-x-1/2 items-start gap-3 rounded-lg border bg-panel px-3 py-2 text-[12.5px] shadow-xl ${err ? 'border-bad' : 'border-accent'}`}
      style={{ top: 'max(8px, env(safe-area-inset-top))' }}
    >
      <span className="min-w-0 flex-1 break-words">{t(notice.key, notice.vars)}</span>
      <button type="button" className="btn btn-ghost h-6 shrink-0 px-2" onClick={dismissNotice} aria-label={t('notice.dismiss')}>
        ✕
      </button>
    </div>
  );
}
