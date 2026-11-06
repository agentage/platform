import { describe, expect, it } from 'vitest';
import { json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { assertConforms, check, RULES, type CheckOptions } from './check.js';
import { type Run } from './exec.js';
import { checkLines } from './format.js';

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
      'dist/cli/index.js': 'export const x = 1;',
    });
    expect((await check(dir, only('entries'))).problems.map((p) => p.problem)).toEqual([
      'part api exports helper beside create',
      'dist/mcp/index.js not found: the package build must write the mcp part there',
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
    const report = await check(await tempPackage({ 'package.json': json(bad), Dockerfile: '' }));
    expect(report.problems).toEqual([
      {
        rule: 'manifest',
        problem: 'agentage.id: lowercase id, never a name the platform owns',
      },
      {
        rule: 'manifest',
        file: 'Dockerfile',
        problem: 'is not allowed: the kit writes every image recipe',
      },
    ]);
  });
});

describe('stack', () => {
  const stackOf = async (dependencies: Record<string, string>) => {
    const pkg = { ...SPEC_MANIFEST, engines: { agentage: '^0.4' }, dependencies };
    const dir = await tempPackage({ 'package.json': json(pkg) });
    return (await check(dir, only('stack'))).problems.map((p) => p.problem);
  };

  it('needs express 5, zod 4, the MCP SDK 2 and a kit inside engines.agentage', async () => {
    const good = { express: '^5.1.0', zod: '^4.2.0', '@agentage/extension': '^0.4.1' };
    expect(await stackOf(good)).toEqual([]);
    const old = { express: '>=4', zod: '^3.23.0', '@modelcontextprotocol/server': '^1.20.0' };
    expect(await stackOf({ ...old, '@agentage/extension': '^0.5.0' })).toEqual([
      'express >=4, needs ^5',
      'zod ^3.23.0, needs ^4',
      '@modelcontextprotocol/server ^1.20.0, needs ^2',
      '@agentage/extension ^0.5.0, needs ^0.4',
    ]);
  });

  it('does not judge a spec that is no semver range, such as a local tarball', async () => {
    expect(
      await stackOf({ '@agentage/extension': 'file:.kit/agentage-extension-0.4.0.tgz' })
    ).toEqual([]);
  });
});

describe('store', () => {
  it('is skipped without a store or without docker, but build never skips it', async () => {
    const api = { ...SPEC_MANIFEST, agentage: { id: 'probe', parts: { api: true } } };
    const none = await check(await tempPackage({ 'package.json': json(api) }), only('store'));
    expect(none.skipped).toEqual({ store: 'no store' });
    const dir = await tempPackage({ ...BUILT, 'migrations/001-a.sql': 'select 1;' });
    const report = await check(dir, { ...only('store'), run: noDocker });
    expect(report).toMatchObject({ conforms: true, skipped: { store: 'no docker' } });
    await expect(assertConforms(dir, { ...only('store'), run: noDocker })).rejects.toThrow(
      'check failed: store: docker does not answer: build needs it'
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
