import { describe, expect, it } from 'vitest';
import { main, type MainDeps } from './main.js';
import { type DownOptions } from './up/down.js';
import { type TokenOptions } from './up/token.js';
import { type UpOptions } from './up/up.js';

const fakes = (failWith?: Error) => {
  const out: string[] = [];
  const err: string[] = [];
  const calls: { up: UpOptions[]; down: DownOptions[]; token: TokenOptions[] } = {
    up: [],
    down: [],
    token: [],
  };
  const step = async () => {
    if (failWith) throw failWith;
  };
  const d: MainDeps = {
    build: async () => Promise.reject(new Error('not here')),
    up: async (options) => (
      calls.up.push(options),
      options.onLine?.('ready    7 parts healthy'),
      step()
    ),
    down: async (options) => (calls.down.push(options), step()),
    token: async (options) => (calls.token.push(options), await step(), 'aga_x'),
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
  };
  return { d, out, err, calls };
};

describe('tool cli: up, down, token', () => {
  it('up passes the folder and prints each line as it comes', async () => {
    const f = fakes();
    expect(await main(['up', '--dir', 'ext'], f.d)).toBe(0);
    expect(f.calls.up).toEqual([{ dir: 'ext', onLine: f.d.out }]);
    expect(f.out).toEqual(['ready    7 parts healthy']);
  });

  it('down passes --keep-data', async () => {
    const f = fakes();
    expect(await main(['down', '--keep-data'], f.d)).toBe(0);
    expect(f.calls.down).toEqual([{ dir: undefined, keepData: true, onLine: f.d.out }]);
  });

  it('token prints the token, and is a usage error without --scope', async () => {
    const f = fakes();
    expect(
      await main(['token', '--scope', 'probe:read', '--issuer', 'http://127.0.0.1:4281'], f.d)
    ).toBe(0);
    expect(f.calls.token).toEqual([{ scope: 'probe:read', issuer: 'http://127.0.0.1:4281' }]);
    expect(f.out).toEqual(['aga_x']);
    const bare = fakes();
    expect(await main(['token'], bare.d)).toBe(2);
    expect(bare.err[0]).toMatch(/^token needs --scope <id>:<verb>\nusage: agentage-extension/);
    expect(bare.calls.token).toEqual([]);
  });

  it('exits 1 with the step name when a step fails, 2 on a second positional', async () => {
    const f = fakes(new Error('docker is not installed or not on PATH'));
    expect(await main(['up'], f.d)).toBe(1);
    expect(await main(['down'], f.d)).toBe(1);
    expect(await main(['token', '--scope', 'probe:read'], f.d)).toBe(1);
    expect(f.err).toEqual([
      'up failed: docker is not installed or not on PATH',
      'down failed: docker is not installed or not on PATH',
      'token failed: docker is not installed or not on PATH',
    ]);
    expect(await main(['up', 'extra'], fakes().d)).toBe(2);
  });
});
