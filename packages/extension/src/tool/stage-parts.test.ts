import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest/read-manifest.js';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { appPaths, MIGRATE_SHIM, stageContext } from './stage.js';

const FULL = validateManifest(SPEC_MANIFEST);

const fullPackage = (extra: Record<string, string> = {}) =>
  tempPackage({
    'package.json': json(SPEC_MANIFEST),
    'package-lock.json': json({ lockfileVersion: 3 }),
    'dist/api/index.js': 'export const create = () => null;',
    'dist/mcp/index.js': 'export const create = () => null;',
    'dist/lib/shared.js': 'export const shared = 1;',
    'dist/cli/index.js': 'export const create = () => ({});',
    'migrations/001-ticks.sql': 'create table ticks (id int);',
    'seeds/001-hello.sql': 'insert into ticks values (1);',
    'openapi.json': json({ openapi: '3.1.0', paths: {} }),
    ...extra,
  });

const tree = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
    .sort();

describe('stage per part', () => {
  it('an mcp image carries dist/mcp and dist/lib only, never the store files', async () => {
    const dir = await fullPackage();
    const root = await stageContext(dir, FULL, 'mcp', dir);
    expect(await tree(join(root, 'app'))).toEqual([
      'dist/lib/shared.js',
      'dist/mcp/index.js',
      'package.json',
    ]);
    expect(await readFile(join(root, 'Dockerfile'), 'utf8')).toContain(
      'dist/runtime/main.js", "mcp"]'
    );
  });

  it('the api image with a postgres store adds migrations, openapi.json and the migrate shim, never the seeds', async () => {
    const dir = await fullPackage();
    const root = await stageContext(dir, FULL, 'api', dir);
    expect(await tree(join(root, 'app'))).toEqual([
      'dist/api/index.js',
      'dist/lib/shared.js',
      'dist/store/migrate.js',
      'migrations/001-ticks.sql',
      'openapi.json',
      'package.json',
    ]);
    expect(await readFile(join(root, 'app/dist/store/migrate.js'), 'utf8')).toBe(MIGRATE_SHIM);
    expect(MIGRATE_SHIM).toContain("import '@agentage/extension/migrate';");
  });

  it('an api image without a store carries no migrations and no shim', async () => {
    const pkg = validateManifest({
      ...SPEC_MANIFEST,
      agentage: { id: 'probe', parts: { api: true, mcp: true } },
    });
    const dir = await fullPackage({ 'package.json': json(pkg) });
    expect(await appPaths(dir, pkg, 'api')).toEqual([
      'package.json',
      'dist/api',
      'openapi.json',
      'dist/lib',
    ]);
    const root = await stageContext(dir, pkg, 'api', dir);
    expect(await tree(join(root, 'app'))).not.toContain('dist/store/migrate.js');
  });

  it('ui needs dist/ui/widgets.json from the widget bundler', async () => {
    const dir = await fullPackage({ 'dist/ui/probe.js': 'export {};' });
    await expect(stageContext(dir, FULL, 'ui', dir)).rejects.toThrow(
      'dist/ui/widgets.json not found: the package build must write the ui part there'
    );
    const built = await fullPackage({
      'dist/ui/probe.js': 'export {};',
      'dist/ui/widgets.json': '[]',
    });
    const root = await stageContext(built, FULL, 'ui', built);
    expect(await tree(join(root, 'app'))).toEqual([
      'dist/lib/shared.js',
      'dist/ui/probe.js',
      'dist/ui/widgets.json',
      'package.json',
    ]);
  });
});
