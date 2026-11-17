import type { BenchObject, KindDef } from '../model';
import type { AreaDriver, DriverCtx, DriverState } from './types';

export const WIFI_ROUTER = 'wifi.router';

const SEC = ['open', 'wpa2', 'wpa3', 'wpa2/wpa3', 'wpa'] as const;
const CHANNELS = ['1', '6', '11', '36', '40', '44', '48', '149', '153', '157', '161'];
const secured = (f: Record<string, unknown>) => f.security !== 'open';

export const wifiKinds: KindDef[] = [
  {
    key: WIFI_ROUTER,
    area: 'wifi',
    labelKey: 'kind.wifi.router',
    descKey: 'kind.wifi.router.desc',
    addKey: 'kind.wifi.router.add',
    fields: [
      { key: 'ssid', labelKey: 'field.networkName', type: 'text' },
      {
        key: 'security',
        labelKey: 'field.security',
        type: 'select',
        options: SEC.map((v) => ({ value: v, label: v === 'open' ? undefined : v === 'wpa2/wpa3' ? 'WPA2/WPA3' : v.toUpperCase(), labelKey: v === 'open' ? ('opt.open' as const) : undefined })),
      },
      { key: 'password', labelKey: 'field.password', type: 'text', when: secured },
      { key: 'signal', labelKey: 'field.signal', type: 'range', min: -90, max: -30, step: 1, unit: ' dBm' },
      { key: 'channel', labelKey: 'field.channel', type: 'select', options: CHANNELS.map((c) => ({ value: c, label: c })) },
      { key: 'internet', labelKey: 'field.internet', type: 'toggle' },
      { key: 'on', labelKey: 'field.powered', type: 'toggle' },
    ],
    defaults: { ssid: 'Dot-Bench', security: 'open', password: 'dotbench1', signal: -45, channel: '6', internet: true, on: true },
    unique: (n) => ({ ssid: n === 1 ? 'Dot-Bench' : `Dot-Bench ${n}` }),
    presence: { on: 'presence.inRange', off: 'presence.outOfRange' },
  },
];

interface Router {
  id: number;
  ssid: string;
  update(p: object): unknown;
}
interface WifiApi {
  addRouter(c: object): Router;
  removeRouter(r: Router): void;
  clearRouters(): void;
  station(): { connected: { routerId: number; ip: string } | null; connecting: boolean; started: boolean };
}

export function routerConfig(o: BenchObject) {
  const f = o.fields;
  const ssid = String(f.ssid ?? '');
  const security = String(f.security ?? 'open');
  const password = security === 'open' ? '' : String(f.password ?? '');
  if (!ssid || new TextEncoder().encode(ssid).length > 32) throw new Error('name: 1 to 32 characters');
  if (security !== 'open' && (password.length < 8 || password.length > 63)) throw new Error('password: 8 to 63 characters');
  return { ssid, security, password, signal: Number(f.signal ?? -45), channel: Number(f.channel ?? 6), internet: !!f.internet, on: f.on !== false, inRange: o.near };
}

function routerBySsid(st: DriverState, ssid: string): string | undefined {
  for (const [id, h] of st.handles) if ((h as Router).ssid === ssid) return id;
  return undefined;
}

export const wifiDriver: AreaDriver<WifiApi, Router> = {
  area: 'wifi',
  deviceArea: 'wifi',
  // the SDK's radio world emits the station's events under the area "radio" (wifi.js says "area:wifi:*"; it is the radio's emit)
  events: [
    'area:radio:connected',
    'area:radio:got-ip',
    'area:radio:disconnected',
    'area:radio:join-failed',
    'area:net:http',
    'area:net:unreachable',
    'area:net:ping',
    'area:net:udp',
    'area:net:mqtt',
  ],
  sig: (o) => JSON.stringify([o.kind, o.fields]),
  // routers live in a module that a later run of the same program finds again: start from none
  wipe: (api) => api.clearRouters(),
  create(api, o, _c, st) {
    const r = api.addRouter(routerConfig(o));
    st.byHw.set(r.id, o.id);
    return r;
  },
  update(api, r, o) {
    r.update(routerConfig(o));
    void api;
  },
  remove(api, r, _o, _c, st) {
    st.byHw.delete(r.id);
    api.removeRouter(r);
  },
  onEvent(name, d, _api, ctx: DriverCtx, st) {
    const type = name.split(':')[2];
    if (name.startsWith('area:net:')) {
      const id = st.byHw.get('connected') as string | undefined;
      if (!id) return;
      if (type === 'http') ctx.say(id, 'live.wifi.http', d.status >= 400 ? 'bad' : 'ok', { method: String(d.method), url: String(d.url), status: Number(d.status) });
      else if (type === 'unreachable') ctx.say(id, 'live.wifi.unreachable', 'bad', { url: String(d.url), why: String(d.why) });
      else if (type === 'ping') ctx.say(id, d.ok ? 'live.wifi.pingOk' : 'live.wifi.pingFail', d.ok ? 'ok' : 'bad', { ip: String(d.ip) });
      else if (type === 'udp') ctx.say(id, 'live.wifi.udp', 'info', { to: String(d.to), port: Number(d.port), bytes: Number(d.bytes) });
      else if (type === 'mqtt') ctx.say(id, 'live.wifi.mqtt', 'info', { state: String(d.state) });
      return;
    }
    const id = routerBySsid(st, String(d.ssid));
    if (!id) return;
    if (type === 'got-ip') ctx.say(id, 'live.wifi.connected', 'ok', { ip: String(d.ip) });
    else if (type === 'join-failed') ctx.say(id, 'live.wifi.joinFailed', 'bad', { why: String(d.why) });
    else if (type === 'disconnected') ctx.say(id, 'live.wifi.left', 'info', { why: String(d.why) });
  },
  poll(api, objects, ctx, st) {
    const s = api.station();
    const conn = s.connected;
    let connectedId: string | undefined;
    for (const o of objects) {
      const r = st.handles.get(o.id) as Router | undefined;
      if (!r) continue;
      const on = !!conn && conn.routerId === r.id;
      if (on) connectedId = o.id;
      ctx.live.setData(o.id, { connected: on, ip: on ? conn!.ip : null });
    }
    if (connectedId) st.byHw.set('connected', connectedId);
    else st.byHw.delete('connected');
    ctx.live.setData('area:wifi', { started: s.started, connecting: s.connecting });
  },
  gone(ctx) {
    ctx.live.clear('area:wifi');
  },
};
