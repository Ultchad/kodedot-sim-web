import { describe, expect, it } from 'vitest';
import { InputController } from './input';
import type { ButtonId, KodeDevice } from '../device/types';

function fake() {
  const calls: string[] = [];
  const dev = {
    setButton: (id: ButtonId, p: boolean) => calls.push(`b:${id}:${p}`),
    setTouch: (x: number, y: number, d: boolean) => calls.push(`t:${x},${y}:${d}`),
  } as unknown as KodeDevice;
  return { calls, ic: new InputController(() => dev) };
}

describe('InputController', () => {
  it('ref-counts button sources', () => {
    const { calls, ic } = fake();
    ic.press('top', 'key');
    ic.press('top', 'p1');
    ic.press('top', 'p1');
    expect(calls).toEqual(['b:top:true']);
    ic.release('top', 'key');
    expect(calls).toEqual(['b:top:true']);
    ic.release('top', 'p1');
    expect(calls).toEqual(['b:top:true', 'b:top:false']);
    expect(ic.pressed.get().size).toBe(0);
  });
  it('only the first pointer drives touch', () => {
    const { calls, ic } = fake();
    expect(ic.touchDown(1, 10, 20)).toBe(true);
    expect(ic.touchDown(2, 99, 99)).toBe(false);
    ic.touchMove(2, 50, 50);
    ic.touchMove(1, 11, 21);
    ic.touchUp(2);
    ic.touchUp(1);
    expect(calls).toEqual(['t:10,20:true', 't:11,21:true', 't:11,21:false']);
    expect(ic.touching).toBe(false);
  });
  it('releaseAll lets go of buttons and touch', () => {
    const { calls, ic } = fake();
    ic.press('up', 'p1');
    ic.touchDown(7, 1, 2);
    ic.releaseAll();
    expect(calls).toContain('b:up:false');
    expect(calls).toContain('t:1,2:false');
    expect(ic.pressed.get().size).toBe(0);
    ic.releaseAll();
  });
});
