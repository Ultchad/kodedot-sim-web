import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { Atom } from '../device/observable';
import type { ButtonId, DeviceStatus } from '../device/types';
import { DEFAULT_HOME_HOLD_MS, HOLD_CAP, HomeHoldController, HomeHoldModel, OVERDUE_MS, SDK_HOME_GRACE_MS, SDK_HOME_HOLD_MS, SHOW_AFTER_MS, homeHoldMs } from './homeHold';

describe('HomeHoldModel', () => {
  it('shows nothing before 200 ms, then fills with the clock', () => {
    const m = new HomeHoldModel();
    m.press(1000, 3200);
    expect(m.view(1000 + SHOW_AFTER_MS - 1).alpha).toBe(0);
    expect(m.view(1000 + SHOW_AFTER_MS).phase).toBe('holding');
    expect(m.view(1000 + 1600).fraction).toBeCloseTo(0.5, 5);
  });
  it('waits below full until the firmware leaves, then is done at full', () => {
    const m = new HomeHoldModel();
    m.press(0, 3200);
    expect(m.view(9000).fraction).toBe(HOLD_CAP);
    expect(m.leave(9000)).toBe(9000);
    const v = m.view(9001);
    expect(v.phase).toBe('done');
    expect(v.fraction).toBe(1);
    expect(m.view(9001 + 1000).alpha).toBe(0);
  });
  it('a short press never shows, and a release at half removes it', () => {
    const m = new HomeHoldModel();
    m.press(0, 3200);
    m.release(150);
    for (let t = 0; t < 600; t += 10) expect(m.view(t).alpha).toBe(0);
    m.press(1000, 3200);
    expect(m.view(2600).alpha).toBe(1);
    m.release(2600);
    expect(m.view(2600 + 500).alpha).toBe(0);
  });
  it('reduced motion: no fade in or out, the bar still fills', () => {
    const m = new HomeHoldModel(() => true);
    m.press(0, 1000);
    expect(m.view(SHOW_AFTER_MS).alpha).toBe(1);
    expect(m.view(500).fraction).toBeCloseTo(0.5, 5);
    m.release(500);
    expect(m.view(501).alpha).toBe(0);
  });
  it('after leaving, the still-held button does not bring the bar back', () => {
    const m = new HomeHoldModel();
    m.press(0, 3200);
    m.leave(3300);
    expect(m.view(5000).alpha).toBe(0);
    expect(m.leave(5000)).toBeNull();
  });
});

describe('homeHoldMs', () => {
  it('uses the SDK rule, per-app exceptions, and what was learned', () => {
    expect(homeHoldMs('light')).toBe(DEFAULT_HOME_HOLD_MS);
    expect(homeHoldMs('kody_kart')).toBe(1100);
    expect(homeHoldMs('buttons_led')).toBe(0);
    expect(homeHoldMs('newgame', 1500)).toBe(1500);
    expect(homeHoldMs('newgame', 50)).toBe(DEFAULT_HOME_HOLD_MS);
  });
  it('the constants match the pinned kode-sdk when it is on this machine', () => {
    const dirs = [process.env.DOTBENCH_SDK, '../.deps/kode-sdk', '/tmp/hb-deps/kode-sdk'].filter(Boolean) as string[];
    const f = dirs.map((d) => `${d}/components/kqp/include/kqp_config.h`).find((p) => fs.existsSync(p));
    if (!f) return;
    const h = fs.readFileSync(f, 'utf8');
    expect(Number(/#define KODE_HOME_HOLD_MS\s+(\d+)U/.exec(h)?.[1])).toBe(SDK_HOME_HOLD_MS);
    expect(Number(/#define KODE_SYS_HOME_GRACE_MS\s+(\d+)U/.exec(h)?.[1])).toBe(SDK_HOME_GRACE_MS);
  });
});

function fake() {
  const status = new Atom<DeviceStatus>('running');
  const program = new Atom<{ id: string; name: string; kind: 'os' | 'app' } | null>({ id: 'b1', name: 'Light', kind: 'app' });
  const apps = new Atom([{ id: 'b1', project: 'light' }]);
  const pressed = new Atom<ReadonlySet<ButtonId>>(new Set());
  const device = { info: { kind: 'wasm' }, detail: {}, status, program, apps };
  let t = 0;
  const learnt: Record<string, number> = {};
  const homes: number[] = [];
  const c = new HomeHoldController({ input: { pressed }, device: device as never, now: () => t, goHome: () => homes.push(t), learn: { load: () => ({ ...learnt }), save: (v) => Object.assign(learnt, v) } });
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, fill() {}, stroke() {}, fillText() {}, measureText: () => ({ width: 10 }) } as unknown as CanvasRenderingContext2D;
  return { status, program, pressed, c, ctx, at: (ms: number) => (t = ms), learnt, homes };
}

describe('HomeHoldController', () => {
  it('follows the bottom button in an app and completes when the device leaves it', () => {
    const f = fake();
    f.at(0);
    f.pressed.set(new Set<ButtonId>(['bottom']));
    f.at(100);
    expect(f.c.draw(f.ctx, 410, 502)).toBe(false);
    f.at(1600);
    expect(f.c.draw(f.ctx, 410, 502)).toBe(true);
    expect(f.c.state.get()).toEqual({ phase: 'holding', percent: 50 });
    f.at(3300);
    f.status.set('booting');
    f.c.draw(f.ctx, 410, 502);
    expect(f.c.state.get()).toEqual({ phase: 'done', percent: 100 });
    expect(f.learnt.light).toBe(3300);
  });
  it('does nothing in kodeOS, nor for other buttons', () => {
    const f = fake();
    f.program.set({ id: 'os', name: 'kodeOS', kind: 'os' });
    f.pressed.set(new Set<ButtonId>(['bottom']));
    f.at(2000);
    expect(f.c.draw(f.ctx, 410, 502)).toBe(false);
    f.pressed.set(new Set<ButtonId>(['top']));
    expect(f.c.state.get().phase).toBe('idle');
  });
  it('an early release leaves no bar', () => {
    const f = fake();
    f.pressed.set(new Set<ButtonId>(['bottom']));
    f.at(1600);
    f.c.draw(f.ctx, 410, 502);
    f.pressed.set(new Set<ButtonId>());
    f.at(2600);
    expect(f.c.draw(f.ctx, 410, 502)).toBe(false);
    expect(f.c.state.get().phase).toBe('idle');
  });
  it('a firmware that does not leave in time: the page sends the Dot home once, and learns nothing from it', () => {
    const f = fake();
    f.pressed.set(new Set<ButtonId>(['bottom']));
    f.at(DEFAULT_HOME_HOLD_MS + OVERDUE_MS - 1);
    f.c.draw(f.ctx, 410, 502);
    expect(f.homes).toEqual([]);
    f.at(DEFAULT_HOME_HOLD_MS + OVERDUE_MS);
    f.c.draw(f.ctx, 410, 502);
    f.c.check();
    expect(f.homes).toEqual([DEFAULT_HOME_HOLD_MS + OVERDUE_MS]);
    f.at(5000);
    f.status.set('booting');
    f.c.draw(f.ctx, 410, 502);
    expect(f.c.state.get()).toEqual({ phase: 'done', percent: 100 });
    expect(f.learnt.light).toBeUndefined();
    f.c.dispose();
  });
  it('a release before the firmware is late never sends the Dot home', () => {
    const f = fake();
    f.pressed.set(new Set<ButtonId>(['bottom']));
    f.at(DEFAULT_HOME_HOLD_MS);
    f.c.draw(f.ctx, 410, 502);
    f.pressed.set(new Set<ButtonId>());
    f.at(DEFAULT_HOME_HOLD_MS + OVERDUE_MS * 3);
    f.c.draw(f.ctx, 410, 502);
    f.c.check();
    expect(f.homes).toEqual([]);
    f.c.dispose();
  });
});
