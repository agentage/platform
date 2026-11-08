import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MANIFEST, json, tempPackage } from '../test-support/packages.js';
import { type CliClient } from './command.types.js';
import { runCommand, type RunCommandOptions } from './run-command.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CLI = `export const create = (ctx) => ({
  whoami: async () => {
    ctx.log.info('who', { user: ctx.user });
    ctx.log.info('again');
    ctx.out.json({ dir: ctx.dir, item: await ctx.client.api('get', '/items/1') });
  },
  nodir: () => { ctx.out.log(ctx.dir); },
  noclient: () => ctx.client.tool('ping'),
});
`;

const probe = () =>
  tempPackage({
    'package.json': json({
      ...API_MANIFEST,
      version: '1.4.2',
      agentage: {
        id: 'probe',
        parts: { api: true, cli: true },
        commands: ['whoami', 'nodir', 'noclient'].map((name) => ({ name, summary: name })),
      },
    }),
    'dist/cli/index.js': CLI,
  });

const run = async (command: string, extra: Partial<RunCommandOptions> = {}) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCommand({
    dir: await probe(),
    command,
    argv: [],
    stdout: (t) => void stdout.push(t),
    stderr: (t) => void stderr.push(t),
    ...extra,
  });
  return { code, stdout: stdout.join(''), stderr };
};

describe('cli ctx', () => {
  it('logs JSON tagged with the command and one agcid per run; dir, user and client from the host', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'agentage-data-'));
    const client: CliClient = { api: async () => ({ id: '1' }), tool: async () => null };
    const user = { sub: 'usr_1', scopes: ['probe:read'] };
    const { code, stdout, stderr } = await run('whoami', { dataDir, client, user });
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ dir: join(dataDir, 'probe'), item: { id: '1' } });
    expect(((await stat(join(dataDir, 'probe'))).mode & 0o777).toString(8)).toBe('700');
    const lines = stderr.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({
      ...{ msg: 'who', 'extension.id': 'probe', 'extension.part': 'cli', version: '1.4.2' },
      ...{ command: 'whoami', user },
    });
    expect(lines[0]?.['agcid']).toMatch(UUID_V7);
    expect(lines[1]?.['agcid']).toBe(lines[0]?.['agcid']);
    const second = await run('whoami', { dataDir, client });
    expect(JSON.parse(second.stderr[0] ?? '{}')).toMatchObject({ user: null });
    expect(JSON.parse(second.stderr[0] ?? '{}')['agcid']).not.toBe(lines[0]?.['agcid']);
  });

  it('says so when the host passes no data dir or no client', async () => {
    expect(await run('nodir')).toMatchObject({
      code: 1,
      stderr: ['ctx.dir: this host passes no data dir\n'],
    });
    expect(await run('noclient')).toMatchObject({
      code: 1,
      stderr: ['ctx.client: this host does not provide a client yet\n'],
    });
  });
});
