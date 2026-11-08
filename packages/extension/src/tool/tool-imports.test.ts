import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { externalImports } from '../test-support/import-graph.js';

// The cli imports @agentage/extension/tool; the server stack must stay out of that graph.
describe('tool entry', () => {
  it('loads no server dependency', () => {
    const external = externalImports(join(resolve(import.meta.dirname), 'index.ts'));
    expect(external.filter((spec) => !spec.startsWith('node:'))).toEqual(['semver', 'zod']);
  });
});
