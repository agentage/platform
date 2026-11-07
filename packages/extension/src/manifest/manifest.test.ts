import { describe, expect, it } from 'vitest';
import cloud from '../test-support/fixtures/neg-package-commands-no-cli.json' with { type: 'json' };
import memory from '../test-support/fixtures/package-memory.json' with { type: 'json' };
import { API_MANIFEST, json, SPEC_MANIFEST, tempPackage } from '../test-support/packages.js';
import { PackageSchema } from './manifest.schema.js';
import { entryOf, hasStore, imageParts, migratesStore, normalizeParts } from './parts.js';
import { SERVED_KINDS, STORE_KINDS } from './primitives.schema.js';
import { readManifest, validateManifest } from './read-manifest.js';

// C1 of the M2 sheet, as an author writes it.
const C1_MANIFEST = {
  name: '@agentage/extension-probe',
  version: '0.2.0',
  engines: { agentage: '^0.2' },
  agentage: {
    id: 'probe',
    parts: {
      pages: true,
      ui: true,
      api: true,
      mcp: true,
      worker: true,
      cli: true,
      store: 'postgres',
    },
    commands: [
      {
        name: 'ping',
        summary: 'answer pong',
        args: [{ name: 'msg', type: 'string', required: false }],
      },
    ],
    settings: { 'mcp.listing': { type: 'string', enum: ['open', 'token'], default: 'open' } },
  },
};

const withAgentage = (agentage: Record<string, unknown>) => ({
  ...API_MANIFEST,
  agentage: { ...API_MANIFEST.agentage, ...agentage },
});

const issuesOf = (value: unknown): string[] => {
  const result = PackageSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
};

describe('manifest schema', () => {
  it('takes the C1 manifest, the full probe manifest of the spec and the api-only form', () => {
    expect(issuesOf(C1_MANIFEST)).toEqual([]);
    expect(issuesOf(SPEC_MANIFEST)).toEqual([]);
    expect(issuesOf(API_MANIFEST)).toEqual([]);
  });

  it('takes the contract form of parts ({} and store.kind) too', () => {
    expect(issuesOf(memory)).toEqual([]);
  });

  it('refuses commands without the cli part, and the reverse', () => {
    expect(issuesOf(cloud)).toContain('commands need the cli part');
    const cli = withAgentage({ parts: { api: true, cli: true } });
    expect(issuesOf(cli)).toContain('the cli part needs commands');
  });

  it('refuses reserved ids, no routed part and duplicate commands', () => {
    const owned = ['lowercase id, never a name the platform owns'];
    for (const id of ['auth', 'Probe', 'extension', 'com1'])
      expect(issuesOf(withAgentage({ id }))).toEqual(owned);
    expect(issuesOf(withAgentage({ id: 'x'.repeat(33) }))).toEqual([expect.stringMatching(/<=32/)]);
    expect(issuesOf(withAgentage({ id: 'authors' }))).toEqual([]);
    expect(issuesOf(withAgentage({ parts: { worker: true } }))).toContain(
      'at least one routed part (pages, ui, api or mcp)'
    );
    const ping = { name: 'ping', summary: 'p' };
    const dup = withAgentage({ parts: { api: true, cli: true }, commands: [ping, ping] });
    expect(issuesOf(dup)).toContain('command names must be unique');
  });

  it('checks settings: mcp.listing needs mcp, default matches type', () => {
    const listing = { 'mcp.listing': { type: 'string', default: 'open' } };
    expect(issuesOf(withAgentage({ settings: listing }))).toContain(
      'mcp.listing needs the mcp part'
    );
    const bad = { 'probe.every': { type: 'integer', default: 1.5 } };
    expect(issuesOf(withAgentage({ settings: bad }))).toContain('default does not match type');
    const outside = { 'probe.mode': { type: 'string', enum: ['a', 'b'], default: 'c' } };
    expect(issuesOf(withAgentage({ settings: outside }))).toEqual(['default is not one of enum']);
  });

  it('keeps first-party ids to the @agentage scope', () => {
    const squat = { ...withAgentage({ id: 'memory' }), name: 'extension-memory' };
    expect(issuesOf(squat)).toContain('a first-party id is claimed only by an @agentage/ package');
  });

  it('refuses unknown keys in the manifest block', () => {
    expect(issuesOf(withAgentage({ contributes: {} }))).toEqual([
      expect.stringContaining('"contributes"'),
    ]);
  });

  it('takes required on a command arg, or neither key, never optional', () => {
    const [ping] = SPEC_MANIFEST.agentage.commands;
    const arg = (keys: object) => ({
      ...SPEC_MANIFEST,
      agentage: {
        ...SPEC_MANIFEST.agentage,
        commands: [{ ...ping, args: [{ name: 'msg', type: 'string', ...keys }] }],
      },
    });
    expect(issuesOf(arg({ optional: true }))).toEqual([expect.stringContaining('"optional"')]);
    expect([issuesOf(arg({})), issuesOf(arg({ required: true }))]).toEqual([[], []]);
  });
});

describe('parts', () => {
  it('normalizes both forms to one shape', () => {
    expect(normalizeParts(SPEC_MANIFEST.agentage.parts as never)).toEqual({
      code: { pages: {}, ui: {}, api: {}, mcp: {}, worker: {}, cli: {} },
      store: 'postgres',
    });
    expect(normalizeParts({ api: { entry: './build/api.js' }, ui: false })).toEqual({
      code: { api: { entry: './build/api.js' } },
    });
  });

  it('lists image parts and resolves entries', () => {
    const spec = validateManifest(SPEC_MANIFEST);
    expect(imageParts(spec)).toEqual(['pages', 'ui', 'api', 'mcp', 'worker']);
    expect(entryOf(spec, 'api')).toBe('./dist/api/index.js');
    const custom = validateManifest(withAgentage({ parts: { api: { entry: './out/a.js' } } }));
    expect(entryOf(custom, 'api')).toBe('./out/a.js');
    const git = validateManifest(memory);
    const pg = [spec, git, custom].map((pkg) => hasStore(pkg, 'postgres'));
    expect(pg).toEqual([true, false, false]);
    expect([hasStore(git, 'git'), migratesStore(spec), migratesStore(git)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('knows three store kinds, postgres alone with migrations, and serves two', () => {
    expect(STORE_KINDS).toEqual({
      postgres: { migrations: true },
      signoz: { migrations: false },
      git: { migrations: false },
    });
    expect(SERVED_KINDS).toEqual(['postgres', 'signoz']);
    const sqlite = PackageSchema.safeParse(withAgentage({ parts: { api: true, store: 'sqlite' } }));
    expect(sqlite.error?.issues.map((issue) => issue.message)).toEqual([
      'one of postgres, signoz, git',
    ]);
  });
});

describe('readManifest', () => {
  it('reads and validates package.json from a folder', async () => {
    const dir = await tempPackage({ 'package.json': json(API_MANIFEST) });
    await expect(readManifest(dir)).resolves.toEqual(API_MANIFEST);
  });

  it('says which folder has no package.json, and passes any other read error through', async () => {
    await expect(readManifest('/nonexistent/ext')).rejects.toThrow(
      'no package.json in /nonexistent/ext: run it in an extension package folder'
    );
    const dir = await tempPackage({ 'package.json/x': '' });
    await expect(readManifest(dir)).rejects.toThrow(/EISDIR/);
  });

  it('names the file that is not valid JSON', async () => {
    const dir = await tempPackage({ 'package.json': '{"name": ' });
    await expect(readManifest(dir)).rejects.toThrow(`${dir}/package.json is not valid JSON`);
  });

  it('names the failing field', async () => {
    const dir = await tempPackage({ 'package.json': json(withAgentage({ id: 'www' })) });
    await expect(readManifest(dir)).rejects.toThrow(
      new Error(
        'invalid agentage manifest in package.json: agentage.id: lowercase id, never a name the platform owns'
      )
    );
  });
});
