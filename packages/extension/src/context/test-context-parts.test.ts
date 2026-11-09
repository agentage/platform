import { statSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { tempPackage } from '../test-support/packages.js';
import { createTestContext, type TestContext, type TestContextOptions } from './test-context.js';

let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
  vi.restoreAllMocks();
});

const PACKAGE = {
  'migrations/001-ticks.sql': 'create table ticks (id int generated always as identity, job text);',
  'seeds/001-hello.sql': "insert into ticks (job) values ('seed');",
};

// Builds the ctx and boots its store in a hook: the first query migrates and seeds it.
const booted = async (store: TestContextOptions['store']): Promise<void> => {
  ctx = createTestContext({ store });
  await ctx.store.query('select 1');
};

describe('createTestContext({ store: { dir } })', () => {
  beforeEach(async () => booted({ dir: await tempPackage(PACKAGE) }));

  it('gives a throwaway postgres with the package migrations and seeds', async () => {
    expect((await ctx?.store.query('select job from ticks'))?.rows).toEqual([{ job: 'seed' }]);
    expect(ctx?.logs).toEqual([]);
  });
});

describe('createTestContext({ store: true })', () => {
  beforeEach(async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(await tempPackage(PACKAGE));
    await booted(true);
  });

  it('migrates the package in the working folder', async () => {
    const result = await ctx?.store.query<{ n: number }>('select count(*)::int as n from ticks');
    expect(result?.rows).toEqual([{ n: 1 }]);
  });
});

describe('createTestContext', () => {
  it('without store, ctx.store says so on first use', async () => {
    ctx = createTestContext();
    await expect(ctx.store.query('select 1')).rejects.toThrow(
      new Error('this extension declares no store: add parts.store to the manifest')
    );
    expect(ctx.extension).toEqual({
      id: 'test',
      version: '0.0.0',
      part: 'api',
      origin: 'http://127.0.0.1',
      commit: '0'.repeat(40),
    });
  });

  it('runs a scheduled job by name and records its log', async () => {
    ctx = createTestContext();
    const { log } = ctx;
    ctx.schedule('tick', '* * * * *', () => log.info('ticked'));
    const run = await ctx.runJob('tick');
    expect(run).toMatchObject({ job: 'tick', status: 'ok', log: 'info ticked\n' });
    expect(ctx.logs.map((entry) => entry.message)).toEqual([
      'ticked',
      expect.stringMatching(/^tick ok \d+ms$/),
    ]);
    expect(await ctx.runJob('nope')).toBeUndefined();
  });

  it('records registered tools', () => {
    ctx = createTestContext();
    const spec = { description: 'Echo', input: z.object({}), output: z.object({}) };
    ctx.tool('echo', spec, () => ({}));
    expect(ctx.tools.map((tool) => tool.name)).toEqual(['echo']);
  });
});

describe('createTestContext for a command', () => {
  it('records stdout, stderr and the exit code', () => {
    const cmd = createTestContext({ args: { msg: 'hi' }, extension: { id: 'probe' } });
    expect(cmd.extension).toEqual({ id: 'probe', version: '0.0.0', part: 'cli' });
    expect(cmd.args).toEqual({ msg: 'hi' });
    cmd.out.log('pong %s', cmd.args['msg']);
    cmd.out.table([{ a: 1 }]);
    cmd.out.warn('careful\nreally');
    expect(cmd.exitCode).toBeUndefined();
    cmd.out.fail(3, 'nope');
    expect(cmd.output).toEqual({
      stdout: ['pong hi', 'a', '1'],
      stderr: ['careful', 'really', 'nope'],
    });
    expect(cmd.exitCode).toBe(3);
  });

  it('with json, keeps stdout for out.json only', () => {
    const cmd = createTestContext({ args: {}, json: true });
    cmd.out.log('progress');
    cmd.out.json({ ok: true });
    expect(cmd.output.stdout).toEqual(['{', '  "ok": true', '}']);
    expect(cmd.output.stderr).toEqual(['progress']);
  });

  it('records ctx.log and ctx.client calls, with a fixed user and a throwaway dir', async () => {
    const answers = { api: async () => ({ id: '7' }) };
    const cmd = createTestContext({ args: {}, extension: { id: 'probe' }, client: answers });
    cmd.log.info('syncing', { n: 2 });
    expect(await cmd.client.api('post', '/items', { name: 'x' })).toEqual({ id: '7' });
    expect(await cmd.client.tool('ping')).toBeUndefined();
    expect(cmd.logs).toEqual([{ level: 'info', message: 'syncing', fields: { n: 2 } }]);
    expect(cmd.calls).toEqual([
      { kind: 'api', method: 'post', path: '/items', input: { name: 'x' } },
      { kind: 'tool', name: 'ping' },
    ]);
    expect(cmd.user).toEqual({ sub: 'usr_test', scopes: ['probe:read'] });
    expect(cmd.dir).toBe(cmd.dir);
    expect((statSync(cmd.dir).mode & 0o777).toString(8)).toBe('700');
    expect(createTestContext({ args: {}, user: null }).user).toBeNull();
  });
});
