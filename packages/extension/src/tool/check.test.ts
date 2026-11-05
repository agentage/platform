import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest/read-manifest.js';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { assertConforms, check, RULES, type CheckRule } from './check.js';

const PKG = validateManifest(SPEC_MANIFEST);
const CREATE = 'export const create = () => null;';
const BUILT = {
  'package.json': json(SPEC_MANIFEST),
  'dist/pages/index.js': CREATE,
  'dist/api/index.js': CREATE,
  'dist/mcp/index.js': CREATE,
  'dist/worker/index.js': CREATE,
  'dist/ui/widgets.json': '[]',
  'dist/cli/index.js': 'export const create = () => ({ ping: () => 0 });',
};

describe('check', () => {
  it('passes a package whose entries are built and whose cli handlers are the commands', async () => {
    const dir = await tempPackage(BUILT);
    expect(await check({ dir, pkg: PKG })).toEqual([]);
    await expect(assertConforms({ dir, pkg: PKG })).resolves.toBeUndefined();
  });

  it('lists every problem with its rule, then refuses with all of them', async () => {
    const rest = Object.fromEntries(
      Object.entries(BUILT).filter(([file]) => !file.includes('mcp'))
    );
    const dir = await tempPackage({ ...rest, 'dist/cli/index.js': 'export const x = 1;' });
    const mcp = 'dist/mcp/index.js not found: the package build must write the mcp part there';
    const cli = `cli part: ${join(dir, 'dist/cli/index.js')} does not export create(ctx)`;
    expect(await check({ dir, pkg: PKG })).toEqual([
      { rule: 'entries', problem: mcp },
      { rule: 'entries', problem: cli },
    ]);
    await expect(assertConforms({ dir, pkg: PKG })).rejects.toThrow(
      `check failed: entries: ${mcp}; entries: ${cli}`
    );
  });

  it('runs any rule given: the hook M4 adds its rules and fixtures through', async () => {
    const dir = await tempPackage(BUILT);
    const sealing: CheckRule = {
      name: 'sealing',
      run: async () => ['src/api/index.ts calls listen()'],
    };
    expect(await check({ dir, pkg: PKG }, [...RULES, sealing])).toEqual([
      { rule: 'sealing', problem: 'src/api/index.ts calls listen()' },
    ]);
  });
});
