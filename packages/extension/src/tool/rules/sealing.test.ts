import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MANIFEST, json, tempPackage } from '../../test-support/packages.js';
import { check } from '../check.js';
import { sealing } from './sealing.js';

const sealed = async (files: Record<string, string>, manifest: object = API_MANIFEST) => {
  const dir = await tempPackage({ 'package.json': json(manifest), ...files });
  return { dir, problems: (await check(dir, { rules: [sealing] })).problems };
};

const lines = async (files: Record<string, string>) =>
  (await sealed(files)).problems
    .map(({ file, line, problem }) => `${file}:${line} ${problem}`)
    .sort();

describe('sealing: part code never names process', () => {
  it('refuses every read of env or argv, with the line of the match', async () => {
    expect(
      await lines({
        'src/api/index.ts': "const port = process['env']['PORT'];\nconst a = process .argv;",
        'src/api/optional.ts': 'const env = process?.env;',
        'src/api/split.ts': 'const env =\n  process\n    .env;',
        'src/api/global.ts': 'const env = globalThis.process.env;',
      })
    ).toEqual([
      'src/api/global.ts:1 reads process.env',
      'src/api/index.ts:1 reads process.env',
      'src/api/index.ts:2 reads process.argv',
      'src/api/optional.ts:1 reads process.env',
      'src/api/split.ts:2 reads process.env',
    ]);
  });

  it('refuses any other use of process: destructuring, an alias, globalThis, the module', async () => {
    expect(
      await lines({
        'src/api/a.ts': 'const { env } = process;\nconst { argv } = process;',
        'src/api/b.ts': 'const p = process;\np.env;',
        'src/api/c.ts': "const p = globalThis['process'];",
        'src/api/d.mjs': "import { env } from 'node:process';\nconst q = await import('process');",
        'src/api/e.cjs': "const { env } = require('node:process');",
      })
    ).toEqual([
      'src/api/a.ts:1 names process',
      'src/api/a.ts:2 names process',
      'src/api/b.ts:1 names process',
      'src/api/c.ts:1 names process',
      'src/api/d.mjs:1 imports process',
      'src/api/d.mjs:2 imports process',
      'src/api/e.cjs:1 imports process',
    ]);
  });

  it('refuses listen() in any form and an absolute agentage URL as the probe test did', async () => {
    expect(
      await lines({
        'src/api/a.ts': "app.listen (1);\nserver.listen?.(2);\nserver['listen'](3);",
        'src/lib/b.ts':
          "const a = '//memory.agentage.io/mcp';\nconst b = `https://${host}.agentage.io`;",
        'src/lib/c.ts':
          "const c = 'HTTPS://MEMORY.AGENTAGE.IO';\nconst d = 'https://user@memory.agentage.io';",
      })
    ).toEqual([
      'src/api/a.ts:1 calls listen()',
      'src/api/a.ts:2 calls listen()',
      'src/api/a.ts:3 calls listen()',
      'src/lib/b.ts:1 names an absolute agentage URL',
      'src/lib/b.ts:2 names an absolute agentage URL',
      'src/lib/c.ts:1 names an absolute agentage URL',
      'src/lib/c.ts:2 names an absolute agentage URL',
    ]);
  });

  it('reads code only: comments, prose in strings, tests and other files refuse nothing', async () => {
    const { problems } = await sealed({
      'src/api/index.ts': [
        '// see https://docs.agentage.io/kit and process.env',
        '/* process.argv, app.listen(1) */',
        "export const create = () => 'the job processes; process the order';",
        "const url = 'https://example.com//x'; // https://agentage.io",
      ].join('\n'),
      'src/api/index.test.ts': "process.env['UPDATE_SNAPSHOT'];",
      'src/README.md': 'process.env',
      'outside.ts': 'process.env',
    });
    expect(problems).toEqual([]);
  });

  it('refuses any symlink it meets: a file, a directory, one with no code extension, src itself', async () => {
    const { dir } = await sealed({ 'src/api/index.ts': '', 'outside/x.ts': 'process.env' });
    await symlink(join(dir, 'outside', 'x.ts'), join(dir, 'src', 'api', 'linked.ts'));
    await symlink(join(dir, 'outside'), join(dir, 'src', 'lib'));
    await symlink(join(dir, 'outside', 'x.ts'), join(dir, 'src', 'data'));
    const found = (await check(dir, { rules: [sealing] })).problems.map((p) => p.file).sort();
    expect(found).toEqual(['src/api/linked.ts', 'src/data', 'src/lib']);
    const linked = await tempPackage({ 'package.json': json(API_MANIFEST), 'real/x.ts': '' });
    await symlink(join(linked, 'real'), join(linked, 'src'));
    expect((await check(linked, { rules: [sealing] })).problems).toEqual([
      { rule: 'sealing', file: 'src', problem: 'is a symlink: part code is plain files' },
    ]);
  });

  it('refuses an installed dependency that carries an agentage manifest', async () => {
    const deps = { '@agentage/extension': '^0.4.0', notes: '^2.0.0' };
    const manifest = { ...API_MANIFEST, dependencies: deps, peerDependencies: { other: '^1' } };
    const dir = await tempPackage({ 'package.json': json(manifest) });
    await mkdir(join(dir, 'node_modules', 'notes'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'notes', 'package.json'), json({ agentage: {} }));
    await mkdir(join(dir, 'node_modules', '@agentage', 'extension'), { recursive: true });
    await writeFile(join(dir, 'node_modules', '@agentage', 'extension', 'package.json'), json({}));
    expect((await check(dir, { rules: [sealing] })).problems.map((p) => p.problem)).toEqual([
      'depends on another extension, notes',
    ]);
  });
});
