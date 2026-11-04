import { describe, expect, it } from 'vitest';
import { API_MANIFEST, json, tempPackage } from '../test-support/packages.js';
import { checkCli } from './check-cli.js';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, runCommand } from './run-command.js';

const CLI = `export const create = ({ out, args }) => ({
  ping: async () => { out.log(args.msg ? 'pong ' + args.msg : 'pong'); return 0; },
  fail: () => out.fail(3, 'nope'),
  crash: () => { throw new Error('boom'); },
  code: () => 5,
  report: () => { out.log('working'); out.json({ ok: true }); },
});
`;

const command = (name: string, args?: object[]) => ({
  name,
  summary: `The ${name} command`,
  ...(args ? { args } : {}),
});

const manifest = (names: string[]) => ({
  ...API_MANIFEST,
  agentage: {
    id: 'probe',
    parts: { api: true, cli: true },
    commands: names.map((name) =>
      name === 'ping'
        ? command(name, [{ name: 'msg', type: 'string', optional: true }])
        : command(name)
    ),
  },
});

const ALL = ['ping', 'fail', 'crash', 'code', 'report'];

const probe = (names: string[] = [...ALL, 'missing'], cli = CLI) =>
  tempPackage({ 'package.json': json(manifest(names)), 'dist/cli/index.js': cli });

const runIn = async (dir: string, name: string, argv: string[] = []) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const write = (into: string[]) => (text: string) => void into.push(text);
  const code = await runCommand({
    dir,
    command: name,
    argv,
    stdout: write(stdout),
    stderr: write(stderr),
  });
  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
};

describe('runCommand', () => {
  it('runs a handler with the parsed args and exits 0', async () => {
    const dir = await probe();
    expect(await runIn(dir, 'ping', ['hi'])).toEqual({
      code: EXIT_OK,
      stdout: 'pong hi\n',
      stderr: '',
    });
    expect((await runIn(dir, 'ping')).stdout).toBe('pong\n');
    expect(await runIn(dir, 'report', ['--json'])).toEqual({
      code: EXIT_OK,
      stdout: '{\n  "ok": true\n}\n',
      stderr: 'working\n',
    });
  });

  it('exits with out.fail, a returned number, or 1 on a throw', async () => {
    const dir = await probe();
    expect(await runIn(dir, 'fail')).toEqual({ code: 3, stdout: '', stderr: 'nope\n' });
    expect((await runIn(dir, 'code')).code).toBe(5);
    expect(await runIn(dir, 'crash')).toEqual({ code: EXIT_FAILED, stdout: '', stderr: 'boom\n' });
  });

  it('exits 2 on usage: an unknown command, too many args, an unknown option', async () => {
    const dir = await probe();
    expect(await runIn(dir, 'deploy')).toMatchObject({
      code: EXIT_USAGE,
      stderr: 'probe has no command deploy\n',
    });
    expect((await runIn(dir, 'ping', ['a', 'b'])).code).toBe(EXIT_USAGE);
    expect((await runIn(dir, 'ping', ['--nope'])).code).toBe(EXIT_USAGE);
  });

  it('prints usage for --help without loading the entry', async () => {
    const dir = await probe(ALL, 'throw new Error("never loaded");');
    const help = await runIn(dir, 'ping', ['--help']);
    expect(help.code).toBe(EXIT_OK);
    expect(help.stdout).toMatch(/^usage: agentage ping \[msg\] \[--json\]\n\n {2}The ping command/);
  });

  it('exits 1 for a declared command without a handler, an entry without create, a bad manifest', async () => {
    expect(await runIn(await probe(), 'missing')).toMatchObject({
      code: EXIT_FAILED,
      stderr: 'the cli entry has no handler for missing\n',
    });
    const noCreate = await probe(ALL, 'export const handlers = {};');
    expect((await runIn(noCreate, 'ping')).stderr).toMatch(/does not export create\(ctx\)/);
    const bad = await tempPackage({ 'package.json': json({ name: 'x' }) });
    expect((await runIn(bad, 'ping')).code).toBe(EXIT_FAILED);
  });
});

describe('checkCli', () => {
  it('is null when the handlers are exactly the declared commands', async () => {
    expect(await checkCli(await probe(ALL))).toBeNull();
  });

  it('names the difference, or the reason the entry did not load', async () => {
    expect(await checkCli(await probe())).toBe(
      'cli handlers [code, crash, fail, ping, report] differ from commands [code, crash, fail, missing, ping, report]'
    );
    expect(await checkCli(await probe(ALL, 'export const nothing = 1;'))).toMatch(
      /does not export create/
    );
    expect(await checkCli(await tempPackage({}))).toMatch(/^no package\.json in /);
  });
});
