import { useI18n } from '../i18n';

/**
 * Reserved information architecture for the "Components" section. Honest
 * placeholders: nothing here is functional yet.
 */
export function ComponentsPanel() {
  const { t } = useI18n();
  const entries = [
    { id: 'library', title: t('components.library'), desc: t('components.library.desc') },
    { id: 'make', title: t('components.make'), desc: t('components.make.desc') },
  ];
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3" data-testid="components-panel">
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id} className="rounded-md border border-dashed border-line2 p-3" data-entry={e.id}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-[13px] font-medium">{e.title}</h3>
              <span className="eyebrow shrink-0">{t('components.soon')}</span>
            </div>
            <p className="mb-0 mt-1 text-[12px] text-ink3">{e.desc}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
