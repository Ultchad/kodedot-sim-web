// The five button and switch parts draw as switch symbols on the schematic, from their real manifests.
import { describe, expect, it } from 'vitest';
import { classOf } from './nets';
import { manifest } from './fixtures';

const ids = ['dotbench.push-button', 'dotbench.tact-6mm', 'dotbench.tact-12mm', 'dotbench.latching-button', 'dotbench.toggle-switch', 'dotbench.slide-switch'];

describe('buttons on the schematic', () => {
  for (const id of ids) {
    it(`${id} is drawn as a switch`, () => {
      expect(classOf(manifest(id))).toBe('switch');
    });
  }
});
