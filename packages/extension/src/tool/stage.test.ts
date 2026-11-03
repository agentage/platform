import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest/read-manifest.js';
import { API_MANIFEST, json, tempPackage } from '../test-support/packages.js';
import { localTarballs, stageContext } from './stage.js';

const withDeps = (dependencies: Record<string, string>) =>
  validateManifest({ ...API_MANIFEST, dependencies });

describe('stage', () => {
  it('finds file: tarball dependencies inside the package only', () => {
    const pkg = withDeps({ a: '^1.0.0', b: 'file:.kit/b-1.0.0.tgz', c: 'file:../c' });
    expect(localTarballs(pkg)).toEqual(['.kit/b-1.0.0.tgz']);
    expect(() => localTarballs(withDeps({ x: 'file:../x.tgz' }))).toThrow(/inside the package/);
    expect(localTarballs(API_MANIFEST)).toEqual([]);
  });

  it('stages deps/ and app/ with the recipe, never the record', async () => {
    const pkg = withDeps({ b: 'file:.kit/b-1.0.0.tgz' });
    const dir = await tempPackage({
      'package.json': json(pkg),
      'package-lock.json': json({ lockfileVersion: 3 }),
      '.kit/b-1.0.0.tgz': 'tarball',
      'dist/api/index.js': 'export const create = () => null;',
      'dist/agentage-extension.json': '{}',
      'src/api/index.ts': 'source stays out',
    });
    const root = await stageContext(dir, pkg, 'api', dir);
    expect((await readdir(root)).sort()).toEqual(['Dockerfile', 'app', 'deps']);
    expect((await readdir(join(root, 'deps'))).sort()).toEqual([
      '.kit',
      'package-lock.json',
      'package.json',
    ]);
    expect(await readFile(join(root, 'deps/.kit/b-1.0.0.tgz'), 'utf8')).toBe('tarball');
    expect(await readdir(join(root, 'app/dist'))).toEqual(['api']);
    expect((await stat(join(root, 'app/package.json'))).isFile()).toBe(true);
    expect(await readFile(join(root, 'Dockerfile'), 'utf8')).toContain('FROM node:26-alpine');
  });

  it('needs a lockfile, since the image runs npm ci', async () => {
    const dir = await tempPackage({ 'package.json': json(API_MANIFEST), 'dist/api/index.js': '' });
    await expect(stageContext(dir, API_MANIFEST, 'api', dir)).rejects.toThrow(/package-lock/);
  });
});
