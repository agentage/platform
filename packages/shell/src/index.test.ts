import { describe, expect, it } from 'vitest';
import * as root from './index.js';

// Shell pages depend on exactly these names; getJson and the schemas stay internal.
describe('public surface', () => {
  it('pins the entry', () => {
    expect(Object.keys(root).sort()).toEqual([
      'mountWidgets',
      'readInstallation',
      'readOverlay',
      'writeOverlay',
    ]);
  });
});
