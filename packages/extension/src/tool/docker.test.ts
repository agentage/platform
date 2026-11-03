import { describe, expect, it } from 'vitest';
import { DIGEST } from '../test-support/packages.js';
import { buildArgsOf, createDocker, digestOf } from './docker.js';
import { type Run } from './exec.js';

const fakeRun = (stdout = '', code = 0) => {
  const calls: string[][] = [];
  const run: Run = async (command, args) => {
    calls.push([command, ...args]);
    return { code, stdout };
  };
  return { run, calls };
};

describe('docker', () => {
  it('builds for linux/amd64 with build args and labels', () => {
    const args = buildArgsOf({
      context: '/ctx',
      tag: 'ghcr.io/agentage/probe-api:0.1.0',
      buildArgs: { COMMIT_SHA: 'abc' },
      labels: { 'org.opencontainers.image.revision': 'abc' },
    });
    expect(args).toEqual([
      'build',
      '--platform',
      'linux/amd64',
      '--provenance=false',
      '--tag',
      'ghcr.io/agentage/probe-api:0.1.0',
      '--build-arg',
      'COMMIT_SHA=abc',
      '--label',
      'org.opencontainers.image.revision=abc',
      '/ctx',
    ]);
  });

  it('reads the pushed digest from docker push', async () => {
    const output = `The push refers to repository [ghcr.io/agentage/probe-api]\n0.1.0: digest: ${DIGEST} size: 1786\n`;
    expect(digestOf(output)).toBe(DIGEST);
    expect(() => digestOf('nothing')).toThrow(/no digest/);
    const { run, calls } = fakeRun(output);
    await expect(createDocker(run).push('ghcr.io/agentage/probe-api:0.1.0')).resolves.toBe(DIGEST);
    expect(calls).toEqual([['docker', 'push', 'ghcr.io/agentage/probe-api:0.1.0']]);
  });

  it('fails the build when docker exits non-zero', async () => {
    const { run } = fakeRun('', 1);
    const build = createDocker(run).build({ context: '/c', tag: 't', buildArgs: {}, labels: {} });
    await expect(build).rejects.toThrow('docker build failed with exit code 1');
  });
});
