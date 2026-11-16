import { describe, expect, it } from 'vitest';
import { PANEL_LIMITS, SHELL_GAPS, STAGE_MIN, classifyLayout, panelWidths, planPanels } from './layout';

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

describe('planPanels', () => {
  it('docks both cards on desktops, the bench alone on small laptops and landscape tablets, none below', () => {
    expect(planPanels(1920)).toEqual({ bench: 'dock', console: 'dock' });
    expect(planPanels(1180)).toEqual({ bench: 'dock', console: 'dock' });
    expect(planPanels(1024)).toEqual({ bench: 'dock', console: 'drawer' });
    expect(planPanels(820)).toEqual({ bench: 'drawer', console: 'drawer' });
  });
});

describe('panelWidths', () => {
  const none = { bench: null, console: null };
  const both = { bench: true, console: true };
  it('grows the cards with the viewport and keeps the stage at least STAGE_MIN wide', () => {
    for (const vw of [1180, 1280, 1440, 1920, 2560]) {
      const w = panelWidths(vw, none, both);
      expect(w.bench).toBeGreaterThanOrEqual(PANEL_LIMITS.bench.min);
      expect(w.console).toBeGreaterThanOrEqual(PANEL_LIMITS.console.min);
      expect(vw - w.bench - w.console - SHELL_GAPS).toBeGreaterThanOrEqual(STAGE_MIN);
    }
    expect(panelWidths(1920, none, both).console).toBeGreaterThan(panelWidths(1280, none, both).console);
  });
  it('honours a dragged width but takes it back when the window is too small for it', () => {
    expect(panelWidths(1920, { bench: null, console: 700 }, both).console).toBe(700);
    const tight = panelWidths(1280, { bench: 480, console: 720 }, both);
    expect(1280 - tight.bench - tight.console - SHELL_GAPS).toBeGreaterThanOrEqual(STAGE_MIN);
    expect(panelWidths(1920, { bench: 10, console: 5000 }, both)).toEqual({ bench: PANEL_LIMITS.bench.min, console: PANEL_LIMITS.console.max });
  });
  it('gives a collapsed or undocked card no width', () => {
    expect(panelWidths(1440, none, { bench: true, console: false })).toMatchObject({ console: 0 });
    expect(panelWidths(1440, none, { bench: false, console: false })).toEqual({ bench: 0, console: 0 });
  });
});
