import { useRef, useState, type ComponentType } from 'react';
import type { BlePhone } from '../../bench/drivers/ble';
import { computer } from '../../bench/drivers/usb';
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

/** A phone: what it does with the Dot over Bluetooth, step by step (scan, connect, pair with the passkey). */
const Phone: View = ({ obj }) => {
  const { t } = useI18n();
  const { live, runtime } = useHost();
  const s = useLive(live, obj.id);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const connected = s.data.connected === true, secure = s.data.secure === true, bonded = s.data.bonded === true;
  const dotCode = s.data.passkey as number | string | null | undefined;
  const ask = obj.fields.pairing !== 'auto';
  const run = async (fn: (p: BlePhone) => Promise<{ text: string; bad?: boolean }>) => {
    const p = runtime.handle<BlePhone>(obj.id);
    if (!p || busy) return;
    setBusy(true);
    setMsg({ text: t('ble.r.busy') });
    live.setData(obj.id, { asking: false });
    try {
      setMsg(await fn(p));
    } catch (e) {
      setMsg({ text: String((e as Error).message ?? e), bad: true });
    }
    live.setData(obj.id, { asking: false });
    setBusy(false);
  };
  const pair = () =>
    run(async (p) => {
      if (ask && !code) live.setData(obj.id, { asking: true });
      const r = await p.pair(ask && code ? { passkey: Number(code) } : {});
      return r.ok ? { text: t('ble.r.paired') } : { text: t('ble.r.noPair', { reason: r.status ?? '?' }), bad: true };
    });
  return (
    <>
      <Fields obj={obj} />
      <Well className="flex flex-col gap-2">
        <span className="text-[13.5px]" data-testid="phone-state">
          {t(connected ? 'ble.st.connected' : 'ble.st.notConnected')}
          {secure ? ` · ${t('ble.st.secure')}` : ''}
          {bonded ? ` · ${t('ble.st.bonded')}` : ''}
        </span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm" disabled={busy || !obj.near} onClick={() => void run(async (p) => ((r) => (r.sees ? { text: t('ble.r.sees', { name: r.name ?? '?', rssi: r.rssi ?? 0 }) } : { text: t('ble.r.none'), bad: true }))(await p.scan(2500)))} data-testid="phone-scan">
            {t('ble.scan')}
          </button>
          <button type="button" className="btn btn-sm" disabled={busy || !obj.near || connected} onClick={() => void run(async (p) => ((r) => (r.ok ? { text: t('ble.r.connected') } : { text: t('ble.r.noConnect', { reason: r.reason ?? '?' }), bad: true }))(await p.connect({ wait: 6000 })))} data-testid="phone-connect">
            {t('ble.connect')}
          </button>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || !connected || secure} onClick={() => void pair()} data-testid="phone-pair">
            {t('ble.pair')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={!connected} onClick={() => runtime.handle<BlePhone>(obj.id)?.disconnect()} data-testid="phone-disconnect">
            {t('ble.disconnect')}
          </button>
          <button type="button" className="btn btn-sm btn-ghost" disabled={!bonded} onClick={() => runtime.handle<BlePhone>(obj.id)?.forget()} data-testid="phone-forget">
            {t('ble.forget')}
          </button>
        </div>
        {ask && connected && !secure && (
          <label className="flex flex-col gap-1 text-[13.5px] font-semibold">
            {t('ble.passkey')}
            <input className="field-input font-mono" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" data-testid="phone-passkey" />
          </label>
        )}
        {dotCode != null && dotCode !== '' && connected && !secure && (
          <span className="text-[13px] text-ink2" data-testid="phone-dot-code">
            {t('ble.dotShows', { code: String(dotCode).padStart(6, '0') })}
          </span>
        )}
        {msg && (
          <span className={`text-[13.5px] ${msg.bad ? 'text-[var(--red-text)]' : 'text-ink2'}`} role="status" data-testid="phone-message">
            {msg.text}
          </span>
        )}
      </Well>
      <LiveLines id={obj.id} />
    </>
  );
};

/** The computer on the cable: its serial terminal, files both ways, and an app installed over USB. */
const Computer: View = ({ obj }) => {
  const { t } = useI18n();
  const { live } = useHost();
  const s = useLive(live, obj.id);
  const [line, setLine] = useState('');
  const [path, setPath] = useState('/storage/hello.txt');
  const [runAfter, setRunAfter] = useState(true);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const app = useRef<HTMLInputElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const text = String(s.data.text ?? '');
  const plugged = s.data.plugged === true && obj.near;
  const work = async (what: string, fn: (c: NonNullable<Awaited<ReturnType<typeof computer>>>) => Promise<unknown>) => {
    const c = await computer();
    if (!c || !c.plugged) return setMsg({ text: t('usb.needPlug'), bad: true });
    setBusy(true);
    setMsg({ text: t('ble.r.busy') });
    try {
      await fn(c);
      setMsg({ text: t('usb.ok', { what }) });
    } catch (e) {
      setMsg({ text: t('usb.fail', { reason: String((e as Error).message ?? e).slice(0, 160) }), bad: true });
    }
    setBusy(false);
  };
  const bytesOf = async (f: File | undefined) => (f ? new Uint8Array(await f.arrayBuffer()) : null);
  return (
    <>
      <Fields obj={obj} />
      <div className="on-dark flex flex-col gap-1.5 rounded-2xl bg-dark p-3 text-darktext">
        <span className="tag !text-darktext">{t('usb.terminal')}</span>
        <pre className="m-0 h-32 overflow-auto whitespace-pre-wrap font-mono text-[12px] leading-snug" data-testid="usb-terminal">
          {text}
        </pre>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void computer().then((c) => (c?.plugged ? c.type(line) : setMsg({ text: t('usb.needPlug'), bad: true })));
            setLine('');
          }}
        >
          <input className="field-input is-dark min-w-0 flex-1 font-mono !text-[12.5px]" value={line} onChange={(e) => setLine(e.target.value)} placeholder={t('usb.type')} aria-label={t('usb.type')} disabled={!plugged} data-testid="usb-type" />
          <button type="submit" className="btn btn-sm btn-dark" disabled={!plugged} data-testid="usb-send">
            {t('usb.send')}
          </button>
        </form>
      </div>
      <Well className="flex flex-col gap-2">
        <button type="button" className="btn btn-sm btn-primary self-start" disabled={busy || !plugged} onClick={() => app.current?.click()} data-testid="usb-install">
          {t('usb.install')}
        </button>
        <label className="flex cursor-pointer items-center gap-3 text-[13.5px]">
          <input type="checkbox" className="switch" checked={runAfter} onChange={(e) => setRunAfter(e.target.checked)} />
          {t('usb.install.run')}
        </label>
        <input ref={app} type="file" accept=".dotbench,application/zip" className="sr-only" tabIndex={-1} onChange={(e) => (void bytesOf(e.target.files?.[0]).then((b) => b && work(t('usb.install'), (c) => c.installPackage(b, { run: runAfter }))), (e.target.value = ''))} data-testid="usb-app-file" />
        <span className="tag">{t('usb.files')}</span>
        <input className="field-input font-mono !text-[12.5px]" value={path} onChange={(e) => setPath(e.target.value)} aria-label={t('usb.path')} data-testid="usb-path" />
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-sm" disabled={busy || !plugged} onClick={() => file.current?.click()} data-testid="usb-put">
            {t('usb.put')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !plugged}
            onClick={() =>
              void work(t('usb.get'), async (c) => {
                const r = await c.fileGet(path);
                const url = URL.createObjectURL(new Blob([r.data as BlobPart]));
                const a = document.createElement('a');
                a.href = url;
                a.download = path.split('/').pop() || 'file';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 2000);
              })
            }
            data-testid="usb-get"
          >
            {t('usb.get')}
          </button>
        </div>
        <input ref={file} type="file" className="sr-only" tabIndex={-1} onChange={(e) => (void bytesOf(e.target.files?.[0]).then((b) => b && work(t('usb.put'), (c) => c.filePut(path, b))), (e.target.value = ''))} data-testid="usb-put-file" />
        {msg && (
          <span className={`text-[13.5px] ${msg.bad ? 'text-[var(--red-text)]' : 'text-ink2'}`} role="status" data-testid="usb-message">
            {msg.text}
          </span>
        )}
      </Well>
    </>
  );
};

export const VIEWS: Record<string, View> = {
  'ble.phone': Phone,
  'usb.computer': Computer,
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
