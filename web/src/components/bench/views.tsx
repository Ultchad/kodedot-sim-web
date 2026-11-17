import { useRef, type ComponentType } from 'react';
import { getKind } from '../../bench/kinds';
import type { BenchObject } from '../../bench/model';
import { REMOTE_BUTTONS, type IrRemoteHandle } from '../../bench/drivers/ir';
import { printedNumber } from '../../bench/drivers/util';
import { useI18n, type TKey } from '../../i18n';
import { useLive } from '../../state/hooks';
import { useHost } from '../../state/host';
import { BatteryArt, DoorArt, SignalBars, TvArt, Well } from './art';
import { signalAt } from '../../workbench/layout';
import { Field } from './Field';
import { LiveLines, StatusPill } from './Feedback';

type View = ComponentType<{ obj: BenchObject }>;

function Fields({ obj }: { obj: BenchObject }) {
  const kind = getKind(obj.kind)!;
  if (!kind.fields.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {kind.fields.map((f) => (
        <Field key={f.key} def={f} obj={obj} />
      ))}
    </div>
  );
}

const Generic: View = ({ obj }) => (
  <>
    <Fields obj={obj} />
    <LiveLines id={obj.id} />
  </>
);

const NfcReader: View = ({ obj }) => {
  const { t } = useI18n();
  const { live } = useHost();
  const s = useLive(live, obj.id);
  const seen = s.data.seen as { uid: string | null; text?: string; uri?: string; sessions: number } | null | undefined;
  return (
    <>
      <Well className="flex flex-col gap-1" >
        {seen ? (
          <div data-testid="reader-seen" className="flex flex-col gap-1 text-[14px]">
            <span className="tag">{t('reader.saw')}</span>
            <span className="font-mono text-[14px] font-semibold">{seen.uid ?? '?'}</span>
            <span className="break-words">{seen.uri ?? seen.text ?? t('reader.noMessage')}</span>
          </div>
        ) : (
          <span className="text-[14px] text-ink2" data-testid="reader-waiting">
            {t('reader.waiting')}
          </span>
        )}
      </Well>
      <LiveLines id={obj.id} />
    </>
  );
};

const RfidCard: View = ({ obj }) => {
  const { t, fmt } = useI18n();
  const printed = printedNumber(String(obj.fields.id));
  return (
    <>
      <Fields obj={obj} />
      {printed && (
        <p className="m-0 text-[13px] text-ink2" data-testid="card-printed">
          {t('rfid.printed', { number: fmt.number(Number(printed)) })}
        </p>
      )}
      <LiveLines id={obj.id} />
    </>
  );
};

const RfidTag: View = ({ obj }) => {
  const { t } = useI18n();
  const { live } = useHost();
  const s = useLive(live, obj.id);
  const id = s.data.tagId as string | null | undefined;
  const blank = !obj.fields.blocks;
  return (
    <>
      <Well className="flex flex-col gap-0.5">
        <span className="tag">{t('rfid.holds')}</span>
        <span className="text-[15px] font-semibold" data-testid="tag-holds">
          {id ? <span className="font-mono">{id}</span> : blank ? t('rfid.blank') : t('rfid.programmed')}
        </span>
      </Well>
      <Fields obj={obj} />
      <LiveLines id={obj.id} />
    </>
  );
};

const RfidReader: View = ({ obj }) => {
  const { t } = useI18n();
  const { live } = useHost();
  const s = useLive(live, obj.id);
  const visible = !!s.data.visible;
  const state = visible ? (s.data.match ? 'granted' : 'denied') : 'waiting';
  const presented = s.data.presented as string | undefined;
  const label: TKey = state === 'granted' ? 'door.granted' : state === 'denied' ? 'door.denied' : 'door.waiting';
  return (
    <>
      <Well className="flex items-center gap-4">
        <DoorArt state={state} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-heading text-[18px] font-bold leading-tight" data-testid="door-state" data-state={state}>
            {t(label)}
          </span>
          <span className="text-[13px] text-ink2">{visible && presented ? t('door.presented', { id: presented }) : t('door.hint')}</span>
        </div>
      </Well>
      <Fields obj={obj} />
      <LiveLines id={obj.id} />
    </>
  );
};

const Router: View = ({ obj }) => {
  const { t } = useI18n();
  const { live } = useHost();
  const s = useLive(live, obj.id);
  const connected = !!s.data.connected;
  const on = obj.fields.on !== false;
  const tone = connected ? 'ok' : !on || !obj.near ? 'bad' : 'info';
  const text = connected ? t('wifi.connected', { ip: String(s.data.ip ?? '') }) : !on ? t('wifi.off') : !obj.near ? t('wifi.outOfRange') : t('wifi.idle');
  return (
    <>
      <div className="flex items-center gap-3">
        <SignalBars dbm={signalAt(Number(obj.fields.signal), obj.pos)} on={on && obj.near} />
        <StatusPill tone={tone} testid="router-state">
          {text}
        </StatusPill>
      </div>
      {on && obj.near && (
        <p className="m-0 text-[13px] leading-snug text-ink2" data-testid="router-signal">
          {t('wifi.signalAt', { dbm: signalAt(Number(obj.fields.signal), obj.pos) })}
        </p>
      )}
      <Fields obj={obj} />
      <LiveLines id={obj.id} max={5} label={t('wifi.requests')} />
    </>
  );
};

const Tv: View = ({ obj }) => {
  const f = obj.fields;
  return (
    <>
      <Well className="flex justify-center">
        <TvArt power={!!f.power} volume={Number(f.volume ?? 0)} channel={Number(f.channel ?? 1)} muted={!!f.muted} />
      </Well>
      <LiveLines id={obj.id} max={5} />
    </>
  );
};

const BUTTON_KEY: Record<string, TKey> = { Power: 'ir.btn.power', 'Vol+': 'ir.btn.volUp', 'Vol-': 'ir.btn.volDown', 'Ch+': 'ir.btn.chUp', 'Ch-': 'ir.btn.chDown', Mute: 'ir.btn.mute' };

const Remote: View = ({ obj }) => {
  const { t } = useI18n();
  const { runtime } = useHost();
  const held = useRef<IrRemoteHandle | null>(null);
  const release = () => {
    held.current?.up();
    held.current = null;
  };
  const press = (label: string) => {
    const h = runtime.handle<IrRemoteHandle>(obj.id);
    if (!h) return;
    release();
    held.current = h;
    h.down(label);
  };
  return (
    <>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('ir.buttons')} data-testid="remote-buttons">
        {REMOTE_BUTTONS.map((b) => (
          <button
            key={b}
            type="button"
            className={`btn btn-sm !touch-none ${b === 'Power' ? 'btn-danger' : ''}`}
            data-testid={`remote-${b}`}
            title={t('ir.holdHint')}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              press(b);
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onLostPointerCapture={release}
            onKeyDown={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault();
                press(b);
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') release();
            }}
            onBlur={release}
          >
            {t(BUTTON_KEY[b])}
          </button>
        ))}
      </div>
      <LiveLines id={obj.id} max={3} />
    </>
  );
};

const Battery: View = ({ obj }) => {
  const { t, fmt } = useI18n();
  const { live } = useHost();
  const s = useLive(live, obj.id);
  const level = typeof s.data.level === 'number' ? s.data.level : Number(obj.fields.level);
  const phase = String(s.data.phase ?? 'none');
  const charging = phase === 'pre' || phase === 'fast';
  const mv = typeof s.data.mv === 'number' ? s.data.mv : null;
  return (
    <>
      <Well className="flex items-center gap-4">
        <BatteryArt level={level} charging={charging} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-heading text-[22px] font-bold leading-none" data-testid="battery-level">
            {fmt.number(level)} %
          </span>
          <span className="text-[13px] text-ink2" data-testid="battery-phase">
            {t(charging ? 'power.charging' : phase === 'done' ? 'power.full' : 'power.notCharging')}
            {mv ? ` · ${fmt.number(mv)} mV` : ''}
          </span>
        </div>
      </Well>
      <Fields obj={obj} />
    </>
  );
};

const Charger: View = ({ obj }) => {
  const { t } = useI18n();
  const { live } = useHost();
  const s = useLive(live, obj.id);
  const phase = String(s.data.phase ?? 'none');
  const text = !obj.near ? t('power.unplugged') : phase === 'pre' || phase === 'fast' ? t('power.charging') : phase === 'done' ? t('power.full') : t('power.pluggedIdle');
  return (
    <>
      <StatusPill tone={obj.near ? 'ok' : 'info'} testid="charger-state">
        {text}
      </StatusPill>
      <Fields obj={obj} />
    </>
  );
};

export const VIEWS: Record<string, View> = {
  'nfc.reader': NfcReader,
  'rfid.card': RfidCard,
  'rfid.tag': RfidTag,
  'rfid.reader': RfidReader,
  'wifi.router': Router,
  'ir.tv': Tv,
  'ir.remote': Remote,
  'power.battery': Battery,
  'power.charger': Charger,
};

export const viewOf = (kind: string): View => VIEWS[kind] ?? Generic;
