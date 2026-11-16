import { useI18n } from '../i18n';
import { SectionTitle } from './BenchPanel';
import { Icon, type IconName } from './Glyphs';
import { ScrollArea } from './ui';

/**
 * Reserved information architecture for the "Components" section. Honest
 * placeholders: nothing here is functional yet.
 */
export function ComponentsPanel() {
  const { t } = useI18n();
  const entries: { id: string; title: string; desc: string; tile: string; ink: string; icon: IconName }[] = [
    { id: 'library', title: t('components.library'), desc: t('components.library.desc'), tile: 'var(--tile-amber)', ink: '#191919', icon: 'copy' },
    { id: 'make', title: t('components.make'), desc: t('components.make.desc'), tile: 'var(--tile-blue)', ink: '#fff', icon: 'plus' },
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="components-panel">
      <SectionTitle title={t('nav.components')} subtitle={t('components.subtitle')} />
      <ScrollArea className="-mx-2 min-h-0 flex-1 px-2 py-1" label={t('nav.components')}>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {entries.map((e) => (
            <li key={e.id} className="inner flex items-start gap-3 p-4" data-entry={e.id}>
              <span className="icon-tile" style={{ background: e.tile, color: e.ink, opacity: 0.6 }} aria-hidden>
                <Icon name={e.icon} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[17px] leading-snug">{e.title}</h3>
                <p className="mb-0 mt-0.5 text-[13.5px] leading-snug text-ink2">{e.desc}</p>
                <span className="soon mt-2">{t('components.soon')}</span>
              </div>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
