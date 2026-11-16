import { useEffect } from 'react';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { Icon } from './Glyphs';

/** How long an informational notice stays. Errors stay until dismissed. */
export const NOTICE_INFO_MS = 7000;

/**
 * Notices float at the top of the stage (over the device's bezel: never over its buttons, the console input or the
 * read-outs). Information leaves by itself; errors wait for the visitor.
 */
export function NoticeBanner() {
  const { t } = useI18n();
  const { notice, dismissNotice } = useHost();
  useEffect(() => {
    if (!notice || notice.kind !== 'info') return;
    const id = setTimeout(dismissNotice, NOTICE_INFO_MS);
    return () => clearTimeout(id);
  }, [notice, dismissNotice]);
  if (!notice) return null;
  const err = notice.kind === 'error';
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center px-3" style={{ top: 'max(8px, env(safe-area-inset-top))' }}>
      <div
        key={notice.id}
        role={err ? 'alert' : 'status'}
        data-testid="notice"
        data-kind={notice.kind}
        data-layer="notice"
        className="toast anim-rise pointer-events-auto flex w-full max-w-[34rem] items-start gap-3 rounded-3xl py-2.5 pl-5 pr-2.5 text-[14.5px] shadow-[var(--shadow-pop)]"
      >
        <span aria-hidden className={`mt-[9px] inline-block h-2.5 w-2.5 shrink-0 rounded-full ${err ? 'bg-err' : 'bg-primary'}`} />
        <span className="min-w-0 flex-1 py-1 leading-snug [overflow-wrap:anywhere]">{t(notice.key, notice.vars)}</span>
        <button type="button" className="btn btn-sm btn-icon shrink-0" onClick={dismissNotice} aria-label={t('notice.dismiss')} title={t('notice.dismiss')} data-testid="notice-dismiss">
          <Icon name="close" size={17} />
        </button>
      </div>
    </div>
  );
}
