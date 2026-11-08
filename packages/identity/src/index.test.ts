import { describe, expect, it } from 'vitest';
import * as root from './index.js';

// Pages depend on exactly these names; authCalls stays internal.
describe('public surface', () => {
  it('pins the entry', () => {
    expect(Object.keys(root).sort()).toEqual(['createIdentity']);
  });
});
