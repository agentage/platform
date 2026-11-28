import { readFileSync } from 'node:fs';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Server } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, tempDir } from '../../extension/src/test-support/packages.js';
import { runCheck } from './cloud-check-mode.js';
import { PROGRAM_VERSION } from './program-version.js';

const FIXTURES = new URL('../fixtures/check/', import.meta.url).pathname;
const HOSTS = ['test', 'platform', 'core', 'root'];
const program = { version: PROGRAM_VERSION };

afterEach(() => vi.restoreAllMocks());

const check = async (dir: string) => {
  const lines: string[] = [];
  const code = await runCheck(dir, (line) => lines.push(line));
  return { code, lines };
};

// A copy of the platform fixture in a folder named `folder`, its installation changed by `edit`.
const hostWith = async (edit: (doc: Record<string, unknown>) => unknown, folder = 'platform') => {
  const dir = join(await tempDir('agentage-check-'), folder);
  await cp(join(FIXTURES, 'platform'), dir, { recursive: true });
  const doc = JSON.parse(readFileSync(join(dir, 'installation.json'), 'utf8')) as object;
  await writeFile(join(dir, 'installation.json'), json(edit({ ...doc, host: folder })));
  return dir;
};

const row = (extra: object) => ({ id: 'extra', version: '1.0.0', ...extra });
const withRow = (extra: object) => (doc: Record<string, unknown>) => ({
  ...doc,
  extensions: [...(doc['extensions'] as object[]), row(extra)],
});

describe('--check DIR on the host files of app host repo master, in the new form', () => {
  it.each(HOSTS)('%s passes: exit 0, no line', async (host) => {
    expect(await check(join(FIXTURES, host))).toEqual({ code: 0, lines: [] });
  });

  it('each fixture names this program version (a version bump changes them too)', () => {
    for (const host of HOSTS) {
      const doc = JSON.parse(readFileSync(join(FIXTURES, host, 'installation.json'), 'utf8'));
      expect([host, doc.program]).toEqual([host, program]);
    }
  });

  it('the old form (shell.version, no program) fails with one line for each refusal', async () => {
    expect(await check(join(FIXTURES, 'old-form'))).toEqual({
      code: 1,
      lines: [
        'installation.json program: is required: { "version": "x.y.z" }',
        'installation.json shell.version: is gone: the program carries the shell version',
      ],
    });
  });

  it('needs no env and never listens', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen');
    vi.stubEnv('AGENTAGE_URL', '');
    expect((await check(join(FIXTURES, 'platform'))).code).toBe(0);
    expect(listen).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe('each refusal of --check is one line', () => {
  it('no folder named; a folder with no installation.json or no upstreams.json', async () => {
    expect(await check(undefined as unknown as string)).toEqual({
      code: 1,
      lines: ['--check: name the folder of a host: --check DIR'],
    });
    const empty = await tempDir('agentage-check-');
    expect(await check(empty)).toEqual({
      code: 1,
      lines: ['installation.json: absent', 'upstreams.json: absent'],
    });
    const dir = await hostWith((doc) => doc);
    await rm(join(dir, 'upstreams.json'));
    expect(await check(dir)).toEqual({ code: 1, lines: ['upstreams.json: absent'] });
  });

  it('a folder it cannot read is one line, never a throw', async () => {
    const dir = await hostWith((doc) => doc);
    await rm(join(dir, 'installation.json'));
    await mkdir(join(dir, 'installation.json'));
    const { code, lines } = await check(dir);
    expect([code, lines.length]).toEqual([1, 1]);
    expect(lines[0]).toContain('installation.json');
  });

  it.each([
    [
      'source',
      { source: '/src' },
      'extensions[2].source: is for a machine only, not a cloud app host',
    ],
    [
      'enabled',
      { enabled: false },
      'extensions[2].enabled: is for a machine only, not a cloud app host',
    ],
    [
      'no version',
      { version: undefined },
      'extensions[2].version: is required in a cloud app host',
    ],
    ['router', { id: 'router' }, 'extensions[2].id: router is reserved'],
    ['host', { id: 'host' }, 'extensions[2].id: host is reserved'],
    [
      '-pages',
      { id: 'site-pages' },
      'extensions[2].id: site-pages ends in -pages, the name of a pages service',
    ],
    [
      'shell row',
      { id: 'shell-dashboard' },
      'extensions[2].id: shell-dashboard is a shell package; name it in the shell key',
    ],
    ['listed twice', { id: 'fixture' }, 'extensions[2].id: fixture is listed twice'],
    ['unknown key', { image: 'x' }, 'extensions[2]: Unrecognized key: "image"'],
  ])('%s', async (_why, extra, line) => {
    const { code, lines } = await check(await hostWith(withRow(extra)));
    expect([code, lines]).toEqual([1, [`installation.json ${line}`]]);
  });

  it('a host that is not the folder name, and a program of another version', async () => {
    const dir = await hostWith((doc) => ({ ...doc, host: 'other', program: { version: '9.9.9' } }));
    expect((await check(dir)).lines).toEqual([
      'installation.json host: other is not the folder name platform',
      `installation.json program.version: 9.9.9, this program is ${PROGRAM_VERSION}`,
    ]);
  });

  it('a second pages row; a pages row beside the shell key', async () => {
    const pages = { expose: { pages: 'public' } };
    const dir = await hostWith((doc) => {
      const rows = [row({ id: 'a', ...pages }), row({ id: 'b', ...pages })];
      return { ...doc, extensions: rows };
    });
    expect((await check(dir)).lines).toEqual([
      'installation.json extensions[1].expose.pages: a second row serves pages (one per app host)',
      'shell: installation.json names @agentage/shell-dashboard and a public pages part (a); a host has one or the other',
    ]);
  });

  it('a shell package the program does not carry', async () => {
    const dir = await hostWith((doc) => ({ ...doc, shell: { package: '@agentage/other' } }));
    expect((await check(dir)).lines).toEqual([
      'shell: installation.json names @agentage/other, the program carries @agentage/shell-dashboard',
    ]);
  });

  it('an id the host document refuses: the one combine with no reads', async () => {
    const { lines } = await check(await hostWith(withRow({ id: 'api' })));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^installation\.json: the host document refuses it: extensions\.2\.id: /
    );
  });

  it('two issues of the combine are two lines', async () => {
    const two = (doc: Record<string, unknown>) =>
      withRow({ id: 'mcp' })(withRow({ id: 'api' })(doc));
    const { lines } = await check(await hostWith(two));
    expect(lines.map((l) => l.replace(/: lowercase.*$/, ''))).toEqual([
      'installation.json: the host document refuses it: extensions.2.id',
      'installation.json: the host document refuses it: extensions.3.id',
    ]);
  });

  it('a file that is not JSON, and an upstream list the runner refuses', async () => {
    const dir = await hostWith((doc) => doc);
    await writeFile(join(dir, 'installation.json'), '{');
    await writeFile(join(dir, 'upstreams.json'), json([{ id: 'a', service: 'a' }]));
    const { code, lines } = await check(dir);
    expect(code).toBe(1);
    expect(lines[0]).toMatch(/^installation\.json: .*JSON/);
    expect(lines[1]).toMatch(/^upstreams\.json \[0\.address\]: /);
  });
});
