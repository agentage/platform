import { describe, expect, it } from 'vitest';
import * as bundler from './bundle/index.js';
import * as ds from './ds/index.js';
import * as root from './index.js';
import * as register from './register/index.js';

// The probe and the kit depend on exactly these names; defineWidget stays internal.
describe('public surface', () => {
  it('pins every entry', () => {
    expect(Object.keys(root).sort()).toEqual([
      'EnvelopeSchema',
      'createBridge',
      'hostError',
      'useHost',
    ]);
    expect(Object.keys(ds).sort()).toEqual(['Button', 'Card']);
    expect(Object.keys(register).sort()).toEqual(['registerWidgets']);
    expect(Object.keys(bundler).sort()).toEqual(['bundle']);
  });
});
