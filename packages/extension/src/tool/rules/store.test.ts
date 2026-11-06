import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_MANIFEST, json, SPEC_MANIFEST, tempPackage } from '../../test-support/packages.js';
import { chmod } from 'node:fs/promises';
import { check, type CheckOptions } from '../check.js';
import { runCommand, type Run, type RunOptions } from '../exec.js';
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

const HAS_DOCKER = await runCommand('docker', ['version'], { quiet: true }).then(
  ({ code }) => code === 0,
  () => false
);

describe('store', () => {
  it('applies the migrations in one attached, removed, networkless postgres 18 run', async () => {
    const docker = fakeDocker();
    const { dir, report } = await storeOf(MIGRATIONS, { run: docker.run });
    expect(report).toMatchObject({ conforms: true, skipped: {} });
    expect(docker.calls.map((c) => c.args[0])).toEqual(['version', 'run']);
    const { args, options } = docker.calls[1] ?? { args: [] };
    expect(args.slice(0, 13)).toEqual([
      ...['run', '--rm', '--init', '-e', 'TINI_KILL_PROCESS_GROUP=1', '--network', 'none'],
      ...['-v', `${join(dir, 'migrations')}:/migrations:ro`, '--entrypoint', 'sh'],
      ...['postgres:18-alpine', '-c'],
    ]);
    expect(args.slice(14)).toEqual(['sh', '001-a.sql', '002-b.sql']);
    // Root copies the files to a readable place, so a 0600 checkout works; psql runs as postgres.
    expect(args[13]).toMatch(
      /^cp -r \/migrations \/tmp\/m && chmod -R a\+rX \/tmp\/m && exec su postgres /
    );
    expect(args.join(' ')).not.toMatch(/ (-p|--publish)\b/);
    expect(options).toEqual({ quiet: true, timeoutMs: TIMEOUTS.start });
  });

  it('names the failing file and line as psql reports them', async () => {
    const stderr = 'psql:/tmp/m/002-b.sql:3: ERROR:  relation "missing" does not exist\n';
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

  it('says the store image does not run when docker itself fails', async () => {
    const pull = `Unable to find image 'postgres:18-alpine' locally\ndocker: Error response from daemon: manifest unknown\n\nRun 'docker run --help' for more information\n`;
    const { report } = await storeOf(MIGRATIONS, { run: fakeDocker(0, 125, pull).run });
    expect(report.problems).toEqual([
      {
        rule: 'store',
        problem: 'postgres:18-alpine does not run: Error response from daemon: manifest unknown',
      },
    ]);
  });

  it('refuses a psql meta-command anywhere in a statement, and a bad file name, before docker', async () => {
    const docker = fakeDocker();
    const metas = [
      'select 1;\n  \\! rm -rf /',
      'create table m (id int); \\echo done',
      "select 'create table g (id int)' \\gexec",
    ];
    for (const sql of metas) {
      const { report } = await storeOf({ 'migrations/001-a.sql': sql }, { run: docker.run });
      expect(report.problems).toEqual([
        {
          rule: 'store',
          file: 'migrations/001-a.sql',
          line: sql.startsWith('select 1;') ? 2 : 1,
          problem: 'has a psql meta-command: the migrate job sends plain SQL',
        },
      ]);
    }
    const badName = { 'migrations/2-x.sql': 'select 1;' };
    expect((await storeOf(badName, { run: docker.run })).report.problems).toEqual([
      { rule: 'store', problem: 'migrations: not NNN-name.sql: 2-x.sql' },
    ]);
    expect(docker.calls).toEqual([]);
  });

  it('passes a backslash inside a string, a $$ body or a comment', async () => {
    const sql = [
      "insert into t values ('a\\b', E'');",
      'create function f() returns int as $$\n\\ not psql\n$$ language sql;',
      'create function g() returns int as $body$ select 1 \\ $body$ language sql;',
      '-- \\echo in a comment',
      '/* \\gexec\n\\! in a block */ select 1;',
    ].join('\n');
    const docker = fakeDocker();
    const { report } = await storeOf({ 'migrations/001-a.sql': sql }, { run: docker.run });
    expect(report).toMatchObject({ conforms: true });
    expect(docker.calls.map((c) => c.args[0])).toEqual(['version', 'run']);
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

  it.skipIf(!HAS_DOCKER)(
    'applies a 0600 migration in a 0700 folder on the real image (needs docker)',
    async () => {
      const files = {
        'package.json': json(SPEC_MANIFEST),
        'migrations/001-a.sql': 'create table a (id int);',
      };
      const dir = await tempPackage(files);
      await chmod(join(dir, 'migrations', '001-a.sql'), 0o600);
      await chmod(join(dir, 'migrations'), 0o700);
      expect(await check(dir, { rules: [store], requireDocker: true })).toMatchObject({
        conforms: true,
      });
    }
  );
});
