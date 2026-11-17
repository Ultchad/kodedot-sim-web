import { describe, expect, it } from 'vitest';
import { isEditableTarget, keyToButton, ownsArrowKeys } from './keys';

describe('keyToButton', () => {
  it('maps T, B and arrows', () => {
    expect(keyToButton({ key: 't' })).toBe('top');
    expect(keyToButton({ key: 'T' })).toBe('top');
    expect(keyToButton({ key: 'b' })).toBe('bottom');
    expect(keyToButton({ key: 'ArrowUp' })).toBe('up');
    expect(keyToButton({ key: 'ArrowDown' })).toBe('down');
    expect(keyToButton({ key: 'ArrowLeft' })).toBe('left');
    expect(keyToButton({ key: 'ArrowRight' })).toBe('right');
  });
  it('ignores other keys and modified combos', () => {
    expect(keyToButton({ key: 'x' })).toBeNull();
    expect(keyToButton({ key: 'Enter' })).toBeNull();
    expect(keyToButton({ key: 't', ctrlKey: true })).toBeNull();
    expect(keyToButton({ key: 'b', metaKey: true })).toBeNull();
    expect(keyToButton({ key: 'ArrowUp', altKey: true })).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('detects inputs and contenteditable', () => {
    expect(isEditableTarget({ tagName: 'INPUT' })).toBe(true);
    expect(isEditableTarget({ tagName: 'textarea' })).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
  it('lets a layer keep the keyboard for itself (the guide)', () => {
    const inGuide = { tagName: 'A', closest: (sel: string) => (sel === '[data-own-keys]' ? {} : null) };
    const onPage = { tagName: 'BUTTON', closest: () => null };
    expect(isEditableTarget(inGuide)).toBe(true);
    expect(isEditableTarget(onPage)).toBe(false);
  });
});

describe('ownsArrowKeys', () => {
  it('is true inside widgets that use the arrows themselves', () => {
    const inTabs = { closest: (sel: string) => (sel.includes('[role=tablist]') ? {} : null) };
    const plain = { closest: () => null };
    expect(ownsArrowKeys(inTabs)).toBe(true);
    expect(ownsArrowKeys(plain)).toBe(false);
    expect(ownsArrowKeys(null)).toBe(false);
    expect(ownsArrowKeys({})).toBe(false);
  });
});
