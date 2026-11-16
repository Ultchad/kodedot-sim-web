import { useState } from 'react';
import { useI18n } from '../i18n';
import { BenchPanel } from './BenchPanel';
import { ComponentsPanel } from './ComponentsPanel';
import { Icon } from './Glyphs';
import { useTabs } from './ui';

type LeftTab = 'bench' | 'components';
const LEFT_TABS: readonly LeftTab[] = ['bench', 'components'];

/** The left card: Bench and Components behind one tab row, with the collapse button of the card. */
export function LeftPanel({ onClose, closeLabel, bare = false }: { onClose?: () => void; closeLabel?: string; bare?: boolean }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<LeftTab>('bench');
  const tabs = useTabs(LEFT_TABS, tab, setTab);
  return (
    <section className={`flex min-h-0 min-w-0 flex-1 flex-col ${bare ? 'gap-3' : 'card gap-4'}`} aria-label={t('nav.bench')} data-testid="left-panel">
      <div className="flex items-center gap-2">
        <div {...tabs.list} aria-label={t('nav.bench')} className="seg">
          {LEFT_TABS.map((id) => (
            <button key={id} {...tabs.tab(id)} className="chip" data-testid={`left-tab-${id}`}>
              {t(id === 'bench' ? 'nav.bench.short' : 'nav.components')}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {onClose && (
          <button type="button" className="btn btn-sm btn-ghost btn-icon" onClick={onClose} aria-label={closeLabel} title={closeLabel} data-testid="bench-collapse">
            <Icon name="close" />
          </button>
        )}
      </div>
      <div {...tabs.panel(tab)} key={tab} className="anim-fade flex min-h-0 flex-1 flex-col">
        {tab === 'bench' ? <BenchPanel compact={bare} /> : <ComponentsPanel compact={bare} />}
      </div>
    </section>
  );
}
