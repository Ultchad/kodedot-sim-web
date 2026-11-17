import { describe, expect, it } from 'vitest';
import { GOLD, SILVER, bandsOf, capacitorCode, chipResistorCode, microfarads, resistorBands } from './codes';

const bands = (ohms: number) => bandsOf(resistorBands(ohms));

describe('markings of passive parts', () => {
  it('gives a resistor its four bands', () => {
    expect(bands(330)).toEqual([3, 3, 1, GOLD]); // orange orange brown, gold
    expect(bands(4700)).toEqual([4, 7, 2, GOLD]);
    expect(bands(10000)).toEqual([1, 0, 3, GOLD]);
    expect(bands(1000)).toEqual([1, 0, 2, GOLD]); // log10(1000) is not exactly 3 in floating point
    expect(bands(1e6)).toEqual([1, 0, 5, GOLD]);
    expect(bands(1e7)).toEqual([1, 0, 6, GOLD]);
    expect(bands(68)).toEqual([6, 8, 0, GOLD]);
    expect(bands(4.7)).toEqual([4, 7, GOLD, GOLD]);
    expect(bands(0.47)).toEqual([4, 7, SILVER, GOLD]);
    expect(bands(0.1)).toEqual([1, 0, SILVER, GOLD]);
    expect(bands(996)).toEqual([1, 0, 2, GOLD]); // rounds up into the next decade
    expect(bands(0)).toEqual([1, 0, SILVER, GOLD]); // held to what four bands can show
    expect(bands(Number.NaN)).toEqual([1, 0, SILVER, GOLD]);
  });
  it('marks a chip resistor', () => {
    expect(chipResistorCode(330)).toBe('331');
    expect(chipResistorCode(10000)).toBe('103');
    expect(chipResistorCode(47)).toBe('470');
    expect(chipResistorCode(4.7)).toBe('4R7');
    expect(chipResistorCode(0.47)).toBe('R47');
    expect(chipResistorCode(0)).toBe('000');
  });
  it('marks a capacitor in picofarads', () => {
    expect(capacitorCode(0.1)).toBe('104');
    expect(capacitorCode(0.000022)).toBe('22');
    expect(capacitorCode(0.0047)).toBe('472');
    expect(capacitorCode(1)).toBe('105');
    expect(capacitorCode(100)).toBe('107');
    expect(capacitorCode(0.0000047)).toBe('4p7');
    expect(capacitorCode(0.000001)).toBe('1');
    expect(microfarads(100)).toBe('100µF');
    expect(microfarads(4.7)).toBe('4.7µF');
    expect(microfarads(2200)).toBe('2200µF');
  });
});
