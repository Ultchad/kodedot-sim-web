import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { SD_ROOT, SD_SIZES_MB, addFile, joinPath, parentPath, snapshot, type SdAreaApi, type SdSnapshot, type StorageApi } from '../../bench/sd';
import { useI18n } from '../../i18n';
import { useHost } from '../../state/host';
import { Icon, IconTile } from '../Glyphs';
import { useConfirm } from '../ui';
import { StatusPill } from './Feedback';

type Say = { key: 'sd.added' | 'sd.addFailed' | 'sd.removed' | 'sd.full'; name: string; why?: string } | null;

/** The card in the Dot's slot: not a bench object (the card belongs to the Dot and keeps its files), so it draws its own panel. */
export function SdPanel() {
  const { t, fmt } = useI18n();
  const { device, program } = useHost();
  const [dir, setDir] = useState(SD_ROOT);
  const [snap, setSnap] = useState<SdSnapshot | null>(null);
  const [say, setSay] = useState<Say>(null);
  const [over, setOver] = useState(false);
  const [newSize, setNewSize] = useState<number>(SD_SIZES_MB[1]);
  const fileInput = useRef<HTMLInputElement>(null);

  const apis = useCallback((): { sd: SdAreaApi; fs: StorageApi } | null => {
    const a = device.areas as Record<string, unknown>;
    return a.sd && a.storage ? { sd: a.sd as SdAreaApi, fs: a.storage as StorageApi } : null;
  }, [device]);

  const refresh = useCallback(() => {
    const x = apis();
    setSnap(x ? snapshot(x.sd, x.fs, dir) : null);
  }, [apis, dir]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh, program]);

  const swap = useConfirm(() => {
    apis()?.sd.swap(newSize);
    setDir(SD_ROOT);
    refresh();
  });

  const run = (fn: (x: { sd: SdAreaApi; fs: StorageApi }) => void) => {
    const x = apis();
    if (!x) return;
    try {
      fn(x);
    } catch (e) {
      setSay({ key: 'sd.addFailed', name: '', why: String((e as Error).message ?? e) });
    }
    refresh();
  };

  const upload = async (files: FileList | File[]) => {
    const x = apis();
    if (!x || !snap?.inserted) return;
    if (!snap.mounted) x.sd.mount();
    for (const f of Array.from(files)) {
      try {
        const name = addFile(x.fs, dir, f.name, new Uint8Array(await f.arrayBuffer()));
        setSay({ key: 'sd.added', name });
      } catch (e) {
        const why = String((e as Error).message ?? e);
        setSay(/ENOSPC/.test(why) ? { key: 'sd.full', name: f.name } : { key: 'sd.addFailed', name: f.name, why });
      }
    }
    refresh();
  };

  const download = (name: string) =>
    run((x) => {
      const bytes = x.fs.read(joinPath(dir, name));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void upload(e.dataTransfer.files);
  };

  if (!snap) {
    return (
      <div className="inner flex items-center gap-3 p-4" data-testid="sd-off">
        <IconTile area="sd" />
        <p className="m-0 text-[14px] text-ink2">{t('sd.off')}</p>
      </div>
    );
  }

  const usedPct = snap.usage && snap.usage.total ? Math.min(100, Math.round((snap.usage.used / snap.usage.total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3" data-testid="sd-panel" data-inserted={snap.inserted}>
      <div className="inner flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <IconTile area="sd" size={40} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] leading-snug">{t('kind.sd.card')}</h3>
            <p className="tag m-0 mt-0.5 !text-[11px]">{t('sd.size', { mb: snap.capacityMb })}</p>
          </div>
        </div>

        {snap.inserted && snap.usage && (
          <div className="flex flex-col gap-1" data-testid="sd-usage">
            <div className="h-2.5 overflow-hidden rounded-full bg-[var(--raised)]" role="img" aria-label={t('sd.used', { used: fmt.bytes(snap.usage.used), total: fmt.bytes(snap.usage.total) })}>
              <div className="h-full rounded-full bg-[var(--tile-blue)]" style={{ width: `${Math.max(usedPct, snap.usage.used ? 2 : 0)}%` }} />
            </div>
            <span className="text-[13px] text-ink2">{t('sd.used', { used: fmt.bytes(snap.usage.used), total: fmt.bytes(snap.usage.total) })}</span>
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-3 text-[14px] font-semibold">
          <input type="checkbox" className="switch" checked={snap.inserted} onChange={() => run((x) => (snap.inserted ? x.sd.eject() : x.sd.insert()))} data-testid="sd-inserted" />
          <span data-testid="sd-state">{t(snap.inserted ? 'presence.inSlot' : 'presence.ejected')}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-3 text-[14px]">
          <input type="checkbox" className="switch" checked={snap.writeProtect} onChange={(e) => run((x) => x.sd.setWriteProtect(e.target.checked))} data-testid="sd-wp" />
          {t('sd.writeProtect')}
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            {t('sd.newCard')}
            <select className="field-input !w-auto" value={newSize} onChange={(e) => setNewSize(Number(e.target.value))} data-testid="sd-new-size">
              {SD_SIZES_MB.map((mb) => (
                <option key={mb} value={mb}>
                  {mb} MB
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`btn btn-sm ${swap.armed ? 'btn-danger' : ''}`} onClick={swap.press} data-testid="sd-swap">
            {t(swap.armed ? 'sd.swapSure' : 'sd.swap')}
          </button>
        </div>
      </div>

      {snap.inserted && !snap.mounted && (
        <div className="inner flex flex-col gap-2 p-4" data-testid="sd-unmounted">
          <p className="m-0 text-[14px] text-ink2">{t('sd.notMounted')}</p>
          <button type="button" className="btn btn-sm btn-primary self-start" onClick={() => run((x) => x.sd.mount())} data-testid="sd-mount">
            {t('sd.mount')}
          </button>
        </div>
      )}

      {snap.inserted && snap.mounted && (
        <div
          className="inner flex flex-col gap-3 p-4"
          data-drop-files
          data-testid="sd-files"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              setOver(true);
            }
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          style={over ? { boxShadow: 'inset 0 0 0 2px var(--ink)' } : undefined}
        >
          <div className="flex items-center gap-2">
            {dir !== SD_ROOT && (
              <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t('sd.up')} title={t('sd.up')} onClick={() => setDir(parentPath(dir))} data-testid="sd-up">
                <Icon name="chevronUp" />
              </button>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink2" title={dir} data-testid="sd-path">
              {dir}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()} data-testid="sd-add">
              <Icon name="open" size={16} />
              {t('sd.add')}
            </button>
            <input ref={fileInput} type="file" multiple hidden data-testid="sd-file-input" onChange={(e) => (e.target.files && void upload(e.target.files), (e.target.value = ''))} />
          </div>

          {snap.entries.length === 0 ? (
            <p className="m-0 rounded-[var(--radius-row)] border border-dashed border-[var(--ink3)] p-4 text-center text-[14px] text-ink2" data-testid="sd-empty">
              {t('sd.empty')}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0" data-testid="sd-list">
              {snap.entries.map((e) => (
                <li key={e.name} className="flex items-center gap-2 rounded-[12px] bg-[var(--raised-soft)] py-1 pl-3 pr-1" data-testid="sd-entry" data-name={e.name} data-type={e.type}>
                  <Icon name={e.type === 'dir' ? 'folder' : 'file'} size={16} className="text-ink2" />
                  {e.type === 'dir' ? (
                    <button type="button" className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-[14px] font-semibold text-ink" onClick={() => setDir(joinPath(dir, e.name))}>
                      {e.name}
                    </button>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold" title={e.name}>
                      {e.name}
                    </span>
                  )}
                  {e.type === 'file' && <span className="shrink-0 text-[12.5px] tabular-nums text-ink2">{fmt.bytes(e.size)}</span>}
                  {e.type === 'file' && (
                    <button type="button" className="btn btn-sm btn-ghost btn-icon" aria-label={t('sd.download', { name: e.name })} title={t('sd.download', { name: e.name })} onClick={() => download(e.name)} data-testid="sd-download">
                      <Icon name="download" size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost btn-icon"
                    aria-label={t('sd.delete', { name: e.name })}
                    title={t('sd.delete', { name: e.name })}
                    onClick={() => {
                      run((x) => x.fs.remove(joinPath(dir, e.name)));
                      setSay({ key: 'sd.removed', name: e.name });
                    }}
                    data-testid="sd-delete"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="m-0 text-[12.5px] text-ink2">{t('sd.dropHint')}</p>
        </div>
      )}

      {say && (
        <StatusPill tone={say.key === 'sd.added' || say.key === 'sd.removed' ? 'ok' : 'bad'} testid="sd-say">
          {t(say.key, { name: say.name, why: say.why ?? '' })}
        </StatusPill>
      )}
    </div>
  );
}
