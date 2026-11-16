import { describe, expect, it } from 'vitest';
import { classifyLayout } from './layout';

describe('classifyLayout', () => {
  it('classifies viewports', () => {
    expect(classifyLayout(390, 844)).toBe('phone-portrait');
    expect(classifyLayout(844, 390)).toBe('phone-landscape');
    expect(classifyLayout(820, 1180)).toBe('tablet');
    expect(classifyLayout(1180, 820)).toBe('wide');
    expect(classifyLayout(1280, 720)).toBe('wide');
    expect(classifyLayout(1440, 900)).toBe('wide');
  });
});
