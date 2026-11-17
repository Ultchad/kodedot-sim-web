import { Suspense, lazy } from 'react';
import { Icon } from '../components/Glyphs';
import { useI18n } from '../i18n';
import './entry.css';
import type { SectionId } from './route';
import { openGuide, useGuideRoute } from './store';

const Guide = lazy(() => import('./Guide'));

/** Mounts the guide while its link is in the address bar. Its code and texts are fetched the first time. */
export function GuideHost() {
  const { open } = useGuideRoute();
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <Guide />
    </Suspense>
  );
}

/**
 * The one way into the guide from every screen. `bar`: a pill in the top bar. `edge`: the same pill riding on the top
 * edge of the phone's panel (portrait), in the strip the device already keeps clear. `corner`: in a corner of the
 * stage (phone landscape, where the panel can be closed).
 */
export function GuideButton({ variant = 'bar' }: { variant?: 'bar' | 'edge' | 'corner' }) {
  const { t } = useI18n();
  const { open } = useGuideRoute();
  const common = {
    type: 'button' as const,
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'data-guide-entry': '',
    'data-testid': 'guide-open',
    onClick: () => openGuide(),
  };
  if (variant === 'bar') {
    return (
      <button {...common} className="btn">
        <Icon name="help" size={19} />
        {t('nav.guide')}
      </button>
    );
  }
  // on a phone: a small labelled pill with a full-size touch target around it
  return (
    <button
      {...common}
      className={`group absolute z-[45] flex h-11 items-center border-0 bg-transparent p-0 ${variant === 'edge' ? 'right-2 px-1' : 'px-2'}`}
      style={variant === 'edge' ? { top: -34 } : { left: 'env(safe-area-inset-left)', bottom: 'max(4px, env(safe-area-inset-bottom))' }}
    >
      <span className="flex h-[30px] items-center gap-1.5 rounded-full bg-raised pl-2 pr-3 text-[13.5px] font-semibold text-ink shadow-[0_1px_4px_rgba(40,25,10,0.18)] group-active:scale-[0.97]">
        <Icon name="help" size={17} />
        {t('nav.guide')}
      </span>
    </button>
  );
}

/** A quiet "How?" beside a text of the page that the guide explains: it opens the guide on that section. */
export function GuideLink({ to, className = '' }: { to: SectionId; className?: string }) {
  const { t } = useI18n();
  return (
    <button type="button" className={`guide-how ${className}`} aria-haspopup="dialog" aria-label={`${t('guide.how')} ${t('nav.guide')}`} data-testid={`guide-how-${to}`} onClick={() => openGuide(to)}>
      {t('guide.how')}
    </button>
  );
}
