import { describe, expect, it } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { assertConforms, check, RULES, type CheckOptions } from './check.js';
import { type Run } from './exec.js';
import { checkLines } from './format.js';
import { KIT_VERSION } from './kit-version.js';

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

const only = (...names: string[]): CheckOptions => ({
  rules: RULES.filter((rule) => names.includes(rule.name)),
});

const noDocker: Run = async () => ({ code: 1, stdout: '' });

describe('RULES', () => {
  it('is the closed list of extension-kit section 7, in its order', () => {
    expect(RULES.map((rule) => rule.name)).toEqual([
      ...['manifest', 'entries', 'surface'],
      ...['stack', 'store', 'sealing'],
    ]);
  });
});

describe('entries', () => {
  it('passes parts built where their images look, exporting create, cli handlers = commands', async () => {
    expect((await check(await tempPackage(BUILT), only('entries'))).problems).toEqual([]);
  });

  it('names a part not built, one exporting more than create and one without it', async () => {
    const rest = Object.fromEntries(
      Object.entries(BUILT).filter(([file]) => !file.includes('mcp'))
    );
    const dir = await tempPackage({
      ...rest,
      'dist/api/index.js': `${CREATE}\nexport const helper = 1;`,
      'dist/worker/index.js': 'export const create = 42;',
      'dist/cli/index.js': 'export const x = 1;',
    });
    expect((await check(dir, only('entries'))).problems.map((p) => p.problem)).toEqual([
      'part api exports helper beside create',
      'dist/mcp/index.js not found: the package build must write the mcp part there',
      'part worker create is not a function',
      'part cli does not export create',
    ]);
  });

  it('names cli handlers that differ from the declared commands', async () => {
    const dir = await tempPackage({
      ...BUILT,
      'dist/cli/index.js': 'export const create = () => ({});',
    });
    expect((await check(dir, only('entries'))).problems).toEqual([
      { rule: 'entries', problem: 'cli part: cli handlers [] differ from commands [ping]' },
    ]);
  });
});

describe('manifest', () => {
  it('names each schema issue and an image recipe; an invalid manifest stops every later rule', async () => {
    const bad = { ...SPEC_MANIFEST, agentage: { ...SPEC_MANIFEST.agentage, id: 'Probe!' } };
    const recipes = { Dockerfile: '', 'docker-compose.yaml': '', Containerfile: '' };
    const variants = { 'Dockerfile.dev': '', dockerfile: '', 'compose.override.yml': '' };
    const files = { 'package.json': json(bad), ...recipes, ...variants, 'composer.json': '' };
    const report = await check(await tempPackage(files));
    const recipe = 'is not allowed: the kit writes every image recipe';
    expect(report.problems).toEqual([
      { rule: 'manifest', problem: 'agentage.id: lowercase id, never a name the platform owns' },
      { rule: 'manifest', file: 'Containerfile', problem: recipe },
      { rule: 'manifest', file: 'Dockerfile', problem: recipe },
      { rule: 'manifest', file: 'Dockerfile.dev', problem: recipe },
      { rule: 'manifest', file: 'compose.override.yml', problem: recipe },
      { rule: 'manifest', file: 'docker-compose.yaml', problem: recipe },
      { rule: 'manifest', file: 'dockerfile', problem: recipe },
    ]);
  });

  it('a package.json that is not JSON is a manifest problem, not a crash', async () => {
    const report = await check(await tempPackage({ 'package.json': '{ "name": ' }));
    expect(report.conforms).toBe(false);
    expect(report.problems.map((p) => [p.rule, p.problem.split(':')[0]])).toEqual([
      ['manifest', 'package.json is not valid JSON'],
    ]);
  });
});

describe('stack', () => {
  const stackOf = async (dependencies: Record<string, string>, agentage = '^0.4') => {
    const pkg = { ...SPEC_MANIFEST, engines: { agentage }, dependencies };
    const dir = await tempPackage({ 'package.json': json(pkg) });
    return (await check(dir, only('stack'))).problems.map((p) => p.problem);
  };

  it('needs express 5, zod 4, the MCP SDK 2 and a kit range inside engines.agentage', async () => {
    const good = { express: '^5.1.0', zod: '^4.2.0', '@agentage/extension': '^0.4.1' };
    expect(await stackOf(good)).toEqual([]);
    const old = { express: '>=4', zod: '^3.23.0', '@modelcontextprotocol/server': '>=1' };
    expect(await stackOf({ ...old, '@agentage/extension': '^0.5.0' })).toEqual([
      'express >=4, needs ^5',
      'zod ^3.23.0, needs ^4',
      '@modelcontextprotocol/server >=1, needs ^2',
      '@agentage/extension ^0.5.0, needs ^0.4',
    ]);
  });

  it('refuses a spec that is no version range, and the MCP SDK 1 package by name', async () => {
    const specs = {
      express: 'file:vendor/express-4.tgz',
      zod: 'npm:zod@3',
      '@agentage/extension': 'latest',
    };
    expect(
      await stackOf({
        ...specs,
        '@modelcontextprotocol/server': '',
        '@modelcontextprotocol/sdk': '^1.20.0',
      })
    ).toEqual([
      'express file:vendor/express-4.tgz needs a version range',
      'zod npm:zod@3 needs a version range',
      '@modelcontextprotocol/server "" needs a version range',
      '@agentage/extension latest needs a version range',
      '@modelcontextprotocol/sdk is MCP SDK 1: use @modelcontextprotocol/server ^2',
    ]);
  });

  it('needs the running kit inside engines.agentage; a file: kit tarball is not judged', async () => {
    expect(await stackOf({}, '^0.3')).toEqual([
      `kit ${KIT_VERSION} is outside engines.agentage ^0.3`,
    ]);
    const tarball = { '@agentage/extension': 'file:.kit/agentage-extension-0.4.0.tgz' };
    expect(await stackOf(tarball)).toEqual([]);
  });
});

describe('assertConforms', () => {
  it('refuses with one line per problem, and needs docker for the store', async () => {
    const old = { ...SPEC_MANIFEST, engines: { agentage: '^0.3' } };
    const files = { 'package.json': json(old), 'migrations/001-a.sql': 'select 1;' };
    const dir = await tempPackage(files);
    const rules = only('store', 'stack');
    await expect(assertConforms(dir, { ...rules, run: noDocker })).rejects.toThrow(
      `check failed: stack: kit ${KIT_VERSION} is outside engines.agentage ^0.3\ncheck failed: store: docker does not answer: build needs it`
    );
  });
});

describe('checkLines', () => {
  it('prints one line of rule states and PASS, or one line per problem and FAIL (C2)', async () => {
    const dir = await tempPackage({ ...BUILT, 'migrations/001-a.sql': 'select 1;' });
    const pass = await check(dir, { ...only('entries', 'store'), run: noDocker });
    expect(checkLines(pass)).toEqual([
      'entries ok · store skipped: no docker',
      'PASS probe 0.1.0 conforms (2 rules)',
    ]);
    const fail = {
      ...pass,
      conforms: false,
      problems: [
        { rule: 'sealing', file: 'src/api/index.ts', line: 7, problem: 'reads process.env' },
        { rule: 'stack', problem: 'express ^4.19.0, needs ^5' },
      ],
    };
    expect(checkLines(fail)).toEqual([
      'sealing: src/api/index.ts:7 reads process.env',
      'stack: express ^4.19.0, needs ^5',
      'FAIL 2 problems in 2 rules',
    ]);
  });

  it('a rule that throws is a problem of that rule, not a crash', async () => {
    const boom = { name: 'boom', run: () => Promise.reject(new Error('no way')) };
    const report = await check(await tempPackage(BUILT), { rules: [boom] });
    expect(report).toMatchObject({
      conforms: false,
      problems: [{ rule: 'boom', problem: 'no way' }],
    });
  });
});
