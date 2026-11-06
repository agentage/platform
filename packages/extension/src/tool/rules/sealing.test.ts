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

describe('sealing', () => {
  it('names the file and line of each way part code reaches what the host owns', async () => {
    const { problems } = await sealed({
      'src/api/index.ts': "const port = process['env']['PORT'];\napp.listen (port);",
      'src/mcp/args.js': 'export const args = process .argv;',
      'src/worker/index.mjs': "import { env } from 'node:process';",
      'src/lib/links.ts': "const home = '//memory.agentage.io/mcp';",
    });
    expect(problems.map(({ file, line, problem }) => `${file}:${line} ${problem}`).sort()).toEqual([
      'src/api/index.ts:1 reads process.env',
      'src/api/index.ts:2 calls listen()',
      'src/lib/links.ts:1 names an absolute agentage URL',
      'src/mcp/args.js:1 reads process.argv',
      'src/worker/index.mjs:1 imports process',
    ]);
  });

  it('skips tests and other files, refuses a symlink, passes clean code', async () => {
    const { dir, problems } = await sealed({
      'src/api/index.ts': 'export const create = () => null;',
      'src/api/index.test.ts': "process.env['UPDATE_SNAPSHOT'];",
      'src/README.md': 'process.env',
      'outside.ts': 'process.env',
    });
    expect(problems).toEqual([]);
    await symlink(join(dir, 'outside.ts'), join(dir, 'src', 'api', 'linked.ts'));
    expect((await check(dir, { rules: [sealing] })).problems).toEqual([
      {
        rule: 'sealing',
        file: 'src/api/linked.ts',
        problem: 'is a symlink: part code is plain files',
      },
    ]);
  });

  it('refuses an installed dependency that carries an agentage manifest', async () => {
    const deps = {
      '@agentage/extension': '^0.4.0',
      '@agentage/extension-memory': '^1.0.0',
      notes: '^2.0.0',
    };
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
