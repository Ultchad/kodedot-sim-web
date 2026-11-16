import { useEffect, useState } from 'react';
import { useI18n } from './i18n';
import { isPhone } from './lib/layout';
import { useHost } from './state/host';
import { BenchPanel } from './components/BenchPanel';
import { ComponentsPanel } from './components/ComponentsPanel';
import { ConsolePanel } from './components/ConsolePanel';
import { DevicePane } from './components/DevicePane';
import { NoticeBanner } from './components/Notice';
import { Sheet } from './components/Sheet';
import { StatusBar } from './components/StatusBar';
import { TopBar } from './components/TopBar';

type LeftTab = 'bench' | 'components';

function LeftPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState<LeftTab>('bench');
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r border-line bg-panel" aria-label={t('nav.bench')}>
      <div role="tablist" className="flex gap-1 border-b border-line px-2 py-1.5">
        {(['bench', 'components'] as const).map((id) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} className={`btn ${tab === id ? 'is-on' : 'btn-ghost'}`} onClick={() => setTab(id)} data-testid={`left-tab-${id}`}>
            {t(`nav.${id}` as 'nav.bench')}
          </button>
        ))}
      </div>
      {tab === 'bench' ? <BenchPanel /> : <ComponentsPanel />}
    </aside>
  );
}

function RightPanel() {
  const { t } = useI18n();
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-l border-line bg-panel" aria-label={t('nav.console')}>
      <ConsolePanel />
    </aside>
  );
}

/** Accepts .dotbench files dropped anywhere on the window. */
function useWindowDrop() {
  const { addBundleFile } = useHost();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) void addBundleFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [addBundleFile]);
  return dragging;
}

export default function App() {
  const { t } = useI18n();
  const { layout } = useHost();
  const dragging = useWindowDrop();
  const [drawers, setDrawers] = useState({ bench: false, console: false });
  const toggle = (which: 'bench' | 'console') => setDrawers((d) => ({ ...d, [which]: !d[which] }));

  let body;
  if (isPhone(layout)) {
    const land = layout === 'phone-landscape';
    body = (
      <main className="relative flex h-full min-h-0 flex-col overflow-hidden" data-testid="phone-root" data-layout={layout}>
        <div className="flex min-h-0 flex-1 flex-col" style={{ paddingBottom: land ? 0 : 'calc(44px + env(safe-area-inset-bottom))' }}>
          <DevicePane />
        </div>
        <Sheet landscape={land} />
      </main>
    );
  } else if (layout === 'tablet') {
    body = (
      <div className="flex h-full min-h-0 flex-col" data-layout={layout}>
        <TopBar drawers={{ ...drawers, toggle }} />
        <div className="relative flex min-h-0 flex-1">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DevicePane />
          </main>
          {drawers.bench && (
            <div className="absolute inset-y-0 left-0 z-30 flex w-[min(21rem,90vw)] flex-col shadow-2xl" data-testid="drawer-bench-panel">
              <LeftPanel />
            </div>
          )}
          {drawers.console && (
            <div className="absolute inset-y-0 right-0 z-30 flex w-[min(24rem,90vw)] flex-col shadow-2xl" data-testid="drawer-console-panel">
              <RightPanel />
            </div>
          )}
        </div>
        <StatusBar />
      </div>
    );
  } else {
    body = (
      <div className="flex h-full min-h-0 flex-col" data-layout={layout}>
        <TopBar />
        <div className="grid min-h-0 flex-1 grid-cols-[19.5rem_minmax(0,1fr)_22rem] xl:grid-cols-[21rem_minmax(0,1fr)_24rem]">
          <LeftPanel />
          <main className="flex min-h-0 min-w-0 flex-col">
            <DevicePane />
          </main>
          <RightPanel />
        </div>
        <StatusBar />
      </div>
    );
  }

  return (
    <>
      {body}
      <NoticeBanner />
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center border-2 border-dashed border-accent bg-bg/80 font-mono text-[14px] text-accent" data-testid="drop-overlay">
          {t('apps.dropOverlay')}
        </div>
      )}
    </>
  );
}
