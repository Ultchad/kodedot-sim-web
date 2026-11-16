import { useRef } from 'react';
import { useI18n } from '../i18n';
import { useHost } from '../state/host';
import { Icon } from './Glyphs';

/** Export / import of the simulated device's stored data. Feature-detected inside the device; the mock says it has none. */
export function DeviceActions({ onDone }: { onDone?: () => void }) {
  const { t } = useI18n();
  const { exportDevice, importDeviceFile } = useHost();
  const file = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col gap-2">
      <span className="tag">{t('device.data')}</span>
      <button
        type="button"
        className="btn w-full !justify-start"
        data-testid="device-export"
        onClick={() => {
          void exportDevice();
          onDone?.();
        }}
      >
        <Icon name="download" />
        {t('device.export')}
      </button>
      <p className="m-0 px-1 text-[13px] leading-snug text-ink2">{t('device.export.hint')}</p>
      <button type="button" className="btn mt-1 w-full !justify-start" data-testid="device-import" onClick={() => file.current?.click()}>
        <Icon name="open" />
        {t('device.import')}
      </button>
      <p className="m-0 px-1 text-[13px] leading-snug text-ink2">{t('device.import.hint')}</p>
      <input
        ref={file}
        type="file"
        hidden
        data-testid="device-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importDeviceFile(f);
          onDone?.();
        }}
      />
    </div>
  );
}
