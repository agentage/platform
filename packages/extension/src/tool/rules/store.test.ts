import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MANIFEST, json, SPEC_MANIFEST, tempPackage } from '../../test-support/packages.js';
import { check, type CheckOptions } from '../check.js';
import { type Run, type RunOptions } from '../exec.js';
import { TIMEOUTS } from '../timeouts.js';
import { store } from './store.js';

const MIGRATIONS = {
  'migrations/001-a.sql': 'create table a (id int);',
  'migrations/002-b.sql': 'select 1;',
};

// docker version answers `version`; the throwaway store run exits `code` with `stderr`.
const fakeDocker = (version = 0, code = 0, stderr = '') => {
  const calls: { args: string[]; options?: RunOptions }[] = [];
  const run: Run = async (_command, args, options) => {
    calls.push({ args, options });
    return args[0] === 'version' ? { code: version, stdout: '' } : { code, stdout: '', stderr };
  };
  return { run, calls };
};

const storeOf = async (files: Record<string, string>, options: CheckOptions) => {
  const dir = await tempPackage({ 'package.json': json(SPEC_MANIFEST), ...files });
  return { dir, report: await check(dir, { ...options, rules: [store] }) };
};

describe('store', () => {
  it('applies the migrations in one attached, removed, networkless postgres 18 run', async () => {
    const docker = fakeDocker();
    const { dir, report } = await storeOf(MIGRATIONS, { run: docker.run });
    expect(report).toMatchObject({ conforms: true, skipped: {} });
    expect(docker.calls.map((c) => c.args[0])).toEqual(['version', 'run']);
    const { args, options } = docker.calls[1] ?? { args: [] };
    expect(args.slice(0, 15)).toEqual([
      ...['run', '--rm', '--init', '-e', 'TINI_KILL_PROCESS_GROUP=1'],
      ...['--network', 'none', '--user', 'postgres'],
      ...['-v', `${join(dir, 'migrations')}:/migrations:ro`, '--entrypoint', 'sh'],
      ...['postgres:18-alpine', '-c'],
    ]);
    expect(args.slice(16)).toEqual(['sh', '001-a.sql', '002-b.sql']);
    expect(args.join(' ')).not.toMatch(/ (-p|--publish)\b/);
    expect(options).toEqual({ quiet: true, timeoutMs: TIMEOUTS.start });
  });

  it('names the failing file and line as psql reports them', async () => {
    const stderr = 'psql:/migrations/002-b.sql:3: ERROR:  relation "missing" does not exist\n';
    const { report } = await storeOf(MIGRATIONS, { run: fakeDocker(0, 3, stderr).run });
    expect(report.problems).toEqual([
      {
        rule: 'store',
        file: 'migrations/002-b.sql',
        line: 3,
        problem: 'fails on postgres:18-alpine: ERROR: relation "missing" does not exist',
      },
    ]);
  });

  it('refuses a psql meta-command and a bad file name before any docker call', async () => {
    const docker = fakeDocker();
    const meta = { 'migrations/001-a.sql': 'select 1;\n  \\! rm -rf /' };
    expect((await storeOf(meta, { run: docker.run })).report.problems).toEqual([
      {
        rule: 'store',
        file: 'migrations/001-a.sql',
        line: 2,
        problem: 'is a psql meta-command: the migrate job sends plain SQL',
      },
    ]);
    const badName = { 'migrations/2-x.sql': 'select 1;' };
    expect((await storeOf(badName, { run: docker.run })).report.problems).toEqual([
      { rule: 'store', problem: 'migrations: not NNN-name.sql: 2-x.sql' },
    ]);
    expect(docker.calls).toEqual([]);
  });

  it('is skipped without a store or without docker, but build never skips it', async () => {
    const api = await tempPackage({ 'package.json': json(API_MANIFEST) });
    expect((await check(api, { rules: [store] })).skipped).toEqual({ store: 'no store' });
    const docker = fakeDocker(1);
    const { report } = await storeOf(MIGRATIONS, { run: docker.run });
    expect(report).toMatchObject({ conforms: true, skipped: { store: 'no docker' } });
    const strict = await storeOf(MIGRATIONS, { run: docker.run, requireDocker: true });
    expect(strict.report.problems).toEqual([
      { rule: 'store', problem: 'docker does not answer: build needs it' },
    ]);
    expect(docker.calls.map((c) => c.args[0])).toEqual(['version', 'version']);
  });
});
