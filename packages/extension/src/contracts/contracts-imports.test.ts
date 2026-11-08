import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { externalImports } from '../test-support/import-graph.js';

// Clients read the wire schemas; no node builtin, server or store dependency may come with them.
describe('contracts entry', () => {
  it('loads zod and nothing else', () => {
    const entry = join(resolve(import.meta.dirname), 'index.ts');
    expect(externalImports(entry)).toEqual(['zod']);
  });
});
