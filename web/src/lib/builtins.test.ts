import { describe, expect, it } from 'vitest';
import { builtinKey, describeBuiltin, loadBuiltins, parseBuiltins, pickStartApp, type BuiltinApp } from './builtins';

const app = (id: string): BuiltinApp => ({ id, file: `${id}.dotbench`, name: id, description: { en: 'e', es: 's' }, size: 1, version: '', sdkCommit: 'abc' });

describe('builtins', () => {
  it('parses and filters the index', () => {
    expect(parseBuiltins({ apps: [app('a'), { nope: 1 }] }).map((a) => a.id)).toEqual(['a']);
    expect(parseBuiltins(null)).toEqual([]);
  });
  it('falls back to English for a missing translation', () => {
    expect(describeBuiltin(app('a'), 'es')).toBe('s');
    expect(describeBuiltin(app('a'), 'pt-BR')).toBe('e');
  });
  it('starts kodeOS when it is bundled; only an app the user loaded wins over it', () => {
    const list = [app('kodeos'), app('display_lvgl'), app('buttons_led')];
    expect(pickStartApp(null, list, [])).toBe(builtinKey('kodeos'));
    expect(pickStartApp(builtinKey('buttons_led'), list, [])).toBe(builtinKey('kodeos'));
    expect(pickStartApp('u1', list, ['u1'])).toBe('u1');
    expect(pickStartApp('gone', list, ['u1'])).toBe(builtinKey('kodeos'));
  });
  it('without kodeOS a remembered app wins, else the first built-in starts', () => {
    const list = [app('buttons_led'), app('display_lvgl')];
    expect(pickStartApp(null, list, [])).toBe(builtinKey('buttons_led'));
    expect(pickStartApp(builtinKey('display_lvgl'), list, [])).toBe(builtinKey('display_lvgl'));
    expect(pickStartApp(null, [app('only')], [])).toBe(builtinKey('only'));
    expect(pickStartApp(null, [], [])).toBeNull();
  });
  it('treats a failing fetch as no built-ins', async () => {
    expect(await loadBuiltins((async () => { throw new Error('x'); }) as never)).toEqual([]);
    expect(await loadBuiltins((async () => ({ ok: false })) as never)).toEqual([]);
  });
});
