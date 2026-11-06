import { symlink } from 'node:fs/promises';
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

  // The reviewer's cases, both sides: process used as a value is refused, the bare word is not.
  const VALUE_USES: [string, string][] = [
    ['const { env } = process;', 'names process'],
    ['const { argv } = process\n', 'names process'],
    ['const p = process;', 'names process'],
    ['use(process);', 'names process'],
    ['const all = [process];', 'names process'],
    ['const o = { a: process };', 'names process'],
    ['use({ process });', 'names process'],
    ['const v = process.version;', 'names process'],
    ['const e = global.process.env;', 'reads process.env'],
    ["const e = global['process'].env;", 'names process'],
    ['const s = self.process;', 'names process'],
    ["const p = globalThis['process'];", 'names process'],
    ["import { env } from 'node:process';", 'imports process'],
    ["const q = await import('process');", 'imports process'],
    ["const { env } = require('node:process');", 'imports process'],
  ];
  const WORDS = [
    'const o = { process: 1 };',
    'const run = ({ process }) => 1;',
    'export function run({ process }: Ctx) { return 1; }',
    'function process(job) { return job; }',
    'const { process } = ctx;',
    'queue.process(job);',
    'this.process = 1;',
    'export const Note = () => <p>We process your data</p>;',
    "const note = 'We process your data';",
    "const note = 'Stop the process.';",
    'const later = self.process(job);',
  ];

  it.each(VALUE_USES)('refuses %j: %s', async (code, problem) => {
    expect(await lines({ 'src/api/a.tsx': code })).toEqual([`src/api/a.tsx:1 ${problem}`]);
  });

  it.each(WORDS)('passes %j: the word, not the process value', async (code) => {
    expect(await lines({ 'src/ui/a.tsx': code })).toEqual([]);
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

  it('refuses an installed dependency, optional or peer, that carries an agentage manifest', async () => {
    const dependencies = { '@agentage/extension': '^0.4.0', notes: '^2.0.0' };
    const more = { optionalDependencies: { lists: '^1' }, peerDependencies: { other: '^1' } };
    const extension = json({ agentage: {} });
    const dir = await tempPackage({
      'package.json': json({ ...API_MANIFEST, dependencies, ...more }),
      'node_modules/@agentage/extension/package.json': json({}),
      ...Object.fromEntries(
        ['notes', 'lists', 'other'].map((n) => [`node_modules/${n}/package.json`, extension])
      ),
    });
    expect((await check(dir, { rules: [sealing] })).problems.map((p) => p.problem)).toEqual(
      ['notes', 'lists', 'other'].map((name) => `depends on another extension, ${name}`)
    );
  });
});
