import { describe, expect, it } from 'vitest';
import blink from '../../../parts/esp32-blink-echo/manifest.json';
import s3 from '../../../parts/esp32-s3-devkitc/manifest.json';
import pushButton from '../../../parts/push-button/manifest.json';
import resistor from '../../../parts/resistor/manifest.json';
import r3 from '../../../parts/uno-r3/manifest.json';
import minima from '../../../parts/uno-r4-minima/manifest.json';
import wifi from '../../../parts/uno-r4-wifi/manifest.json';
import { translate } from '../i18n/core';
import { buttonHint, buttonsOf, inputFieldsOf } from './controls';
import type { PartManifest } from './service';

const M = (m: unknown): PartManifest => m as PartManifest;

describe('the buttons of a part card', () => {
  it('every control of a board is a button, with the action the engine runs for it', () => {
    for (const m of [r3, minima, wifi]) expect(buttonsOf(M(m)).map((b) => [b.field, b.control.action])).toEqual([['reset', 'restart']]);
    for (const m of [s3, blink]) expect(buttonsOf(M(m)).map((b) => [b.field, b.control.action, b.control.pin])).toEqual([['en', 'restart', undefined], ['boot', 'pull_low', 'IO0']]);
  });

  it('a button is not shown a second time as a switch; the other fields stay inputs', () => {
    expect(inputFieldsOf(M(r3)).map((f) => f.name)).not.toContain('reset');
    expect(inputFieldsOf(M(r3)).length).toBe(M(r3).fields!.length - 1);
    expect(inputFieldsOf(M(s3)).map((f) => f.name)).toEqual(M(s3).fields!.map((f) => f.name).filter((n) => n !== 'en' && n !== 'boot'));
    expect(inputFieldsOf(M(resistor)).map((f) => f.name)).toEqual(M(resistor).fields!.map((f) => f.name));
  });

  it('a plain part keeps its momentary field as the switch it was', () => {
    expect(M(pushButton).controls!.some((c) => c.mode === 'momentary')).toBe(true);
    expect(buttonsOf(M(pushButton))).toEqual([]);
    expect(inputFieldsOf(M(pushButton)).map((f) => f.name)).toContain('pressed');
    expect(buttonsOf(undefined)).toEqual([]);
  });

  it('says what each button does in the three languages', () => {
    const [reset] = buttonsOf(M(r3)), [, boot] = buttonsOf(M(s3));
    expect(buttonHint(reset.control)).toEqual({ key: 'parts.button.restart' });
    expect(buttonHint(boot.control)).toEqual({ key: 'parts.button.pull_low', vars: { pin: 'IO0' } });
    expect(buttonHint({ field: 'x', mode: 'momentary' })).toEqual({ key: 'parts.button.plain' });
    for (const loc of ['en', 'pt-BR', 'es'] as const) {
      const h = buttonHint(boot.control);
      expect(translate(loc, h.key, h.vars)).toContain('IO0');
      expect(translate(loc, 'parts.button.restart')).not.toBe('parts.button.restart');
      expect(translate(loc, 'parts.buttons')).not.toBe('parts.buttons');
    }
    // the labels themselves are the parts library's, in the three languages
    for (const b of [...buttonsOf(M(r3)), ...buttonsOf(M(s3))]) expect(Object.keys(b.control.label ?? {}).sort()).toEqual(['en', 'es', 'pt-BR']);
  });
});
