import { describe, expect, it } from 'vitest';
import { appMeta, displayAppName } from './dotapps';

describe('displayAppName', () => {
  it('writes the system as kodeOS whatever the package calls itself, and leaves app names alone', () => {
    expect(displayAppName('kodeos')).toBe('kodeOS');
    expect(displayAppName(' KodeOS ')).toBe('kodeOS');
    expect(displayAppName('Kody Kart')).toBe('Kody Kart');
    expect(displayAppName('kodeos_tools')).toBe('kodeos_tools');
  });
});

describe('appMeta', () => {
  it('joins version and category, leaving out what is empty or a placeholder', () => {
    expect(appMeta('1.2.0', 'Games')).toBe('1.2.0 · Games');
    expect(appMeta('0.0.0', 'Games')).toBe('Games');
    expect(appMeta('1.0.0', ' ')).toBe('1.0.0');
    expect(appMeta('', '')).toBe('');
  });
});
