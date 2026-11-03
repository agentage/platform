import { describe, expect, it } from 'vitest';
import { DIGEST, SHA } from '../test-support/packages.js';
import { type BuildOptions, type BuildResult } from './build.js';
import { buildLines } from './format.js';
import { main, type MainDeps } from './main.js';

const RESULT: BuildResult = {
  id: 'probe',
  version: '0.1.0',
  commit: SHA,
  buildTime: '2026-11-03T20:00:00Z',
  images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0' }],
};

const deps = (result: BuildResult | Error = RESULT) => {
  const out: string[] = [];
  const err: string[] = [];
  const calls: BuildOptions[] = [];
  const d: MainDeps = {
    build: async (options) => {
      calls.push(options);
      if (result instanceof Error) throw result;
      return result;
    },
    out: (line) => void out.push(line),
    err: (line) => void err.push(line),
  };
  return { d, out, err, calls };
};

describe('tool cli', () => {
  it('build prints one line per image and exits 0', async () => {
    const { d, out, calls } = deps();
    expect(await main(['build', '--push', '--dir', 'x'], d)).toBe(0);
    expect(calls).toEqual([{ push: true, dir: 'x', registry: undefined }]);
    expect(out).toEqual(['api     ghcr.io/agentage/probe-api:0.1.0  built']);
  });

  it('exits 1 when the build fails, 2 on usage, 0 on --help', async () => {
    const failing = deps(new Error('docker build failed'));
    expect(await main(['build'], failing.d)).toBe(1);
    expect(failing.err).toEqual(['build failed: docker build failed']);
    expect(await main([], deps().d)).toBe(2);
    expect(await main(['deploy'], deps().d)).toBe(2);
    expect(await main(['build', '--nope'], deps().d)).toBe(2);
    const help = deps();
    expect(await main(['--help'], help.d)).toBe(0);
    expect(help.out[0]).toMatch(/^usage: agentage-extension build/);
  });
});

describe('buildLines', () => {
  it('shows the short digest of a pushed image and the record path', () => {
    const pushed: BuildResult = {
      ...RESULT,
      images: [{ part: 'api', tag: 'ghcr.io/agentage/probe-api:0.1.0', digest: DIGEST }],
      recordFile: '/repo/dist/agentage-extension.json',
    };
    expect(buildLines(pushed, '/repo')).toEqual([
      'api     ghcr.io/agentage/probe-api:0.1.0  sha256:bbbbbbbb pushed',
      'record  dist/agentage-extension.json',
    ]);
  });
});
