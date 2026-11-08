import { describe, expect, it } from 'vitest';
import { json, SHA } from '../../test-support/packages.js';
import { ENV, fakeDocker, probeDir } from '../../test-support/up-fixtures.js';
import { up } from './up.js';
import { assertHealthBodies } from './health.js';

const body = (data: object) => json({ success: true, data });
const OK = { status: 'ok', commit: SHA };

const assert = (bodies: Record<string, string>, parts = Object.keys(bodies)) =>
  assertHealthBodies(fakeDocker({}, { bodies }).run, { project: 'p' }, parts, SHA);

describe('up asserts each part /health body', () => {
  it('passes when status, commit and part match the build', async () => {
    await expect(assert({ api: body({ ...OK, part: 'api' }) })).resolves.toBeUndefined();
  });

  it('names the part and the first field that differs, one FAIL line each', async () => {
    const bodies = {
      api: body({ ...OK, part: 'api', status: 'degraded' }),
      mcp: body({ ...OK, part: 'mcp', commit: 'b'.repeat(40) }),
      worker: body({ ...OK, part: 'api' }),
      pages: 'not json',
    };
    await expect(assert(bodies)).rejects.toThrow(
      [
        'FAIL api /health status degraded, needs ok',
        `FAIL mcp /health commit ${'b'.repeat(40)}, needs ${SHA}`,
        'FAIL worker /health part api, needs worker',
        'FAIL pages /health body is not the health envelope: not json',
      ].join('\n')
    );
  });

  it('reads the body inside each container on the part port', async () => {
    const docker = fakeDocker();
    await assertHealthBodies(docker.run, { project: 'p' }, ['api'], SHA);
    expect(docker.calls[0]?.args.slice(1, 9)).toEqual([
      'compose',
      '-p',
      'p',
      'exec',
      '-T',
      'api',
      'node',
      '-e',
    ]);
    expect(docker.calls[0]?.args[9]).toContain("fetch('http://127.0.0.1:3000/health')");
  });

  it('stops up after docker reports healthy when a body does not match', async () => {
    const bodies = { mcp: body({ ...OK, part: 'mcp', commit: '0'.repeat(40) }) };
    const docker = fakeDocker({}, { bodies });
    await expect(up({ dir: await probeDir(), env: ENV }, { run: docker.run })).rejects.toThrow(
      `FAIL mcp /health commit ${'0'.repeat(40)}, needs ${SHA}`
    );
  });
});
