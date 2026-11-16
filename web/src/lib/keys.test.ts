import { describe, expect, it } from 'vitest';
import { isEditableTarget, keyToButton } from './keys';

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
});
