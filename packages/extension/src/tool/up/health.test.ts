import { describe, expect, it } from 'vitest';
import { json, SHA } from '../../test-support/packages.js';
import { ENV, fakeDocker, probeDir } from '../../test-support/up-fixtures.js';
import { type Run } from '../exec.js';
import { up } from './up.js';
import { assertHealthBodies } from './health.js';

const body = (data: object) => json({ success: true, data });
const OK = { status: 'ok', commit: SHA };

const assert = (bodies: Record<string, string>, parts = Object.keys(bodies)) =>
  assertHealthBodies(fakeDocker({}, { bodies }).run, { project: 'p' }, parts, SHA);

describe('up asserts each part /health body', () => {
  it('passes when status, commit and part match the build', async () => {
    await expect(assert({ api: body({ ...OK, part: 'api' }) })).resolves.toEqual([]);
  });

  it('accepts degraded and gives each degraded part with its checks that are not ok', async () => {
    const checks = { store: 'degraded', 'job:tick': 'ok' };
    const bodies = { api: body({ ...OK, part: 'api', status: 'degraded', checks }) };
    expect(await assert(bodies)).toEqual([['api', 'store degraded']]);
  });

  it('names the part and the first field that differs, one FAIL line each', async () => {
    const bodies = {
      api: body({ ...OK, part: 'api', status: 'unavailable' }),
      mcp: body({ ...OK, part: 'mcp', commit: 'b'.repeat(40) }),
      worker: body({ ...OK, part: 'api' }),
      pages: 'not json',
    };
    await expect(assert(bodies)).rejects.toThrow(
      [
        'FAIL api /health status unavailable, needs ok or degraded',
        `FAIL mcp /health commit ${'b'.repeat(40)}, needs ${SHA}`,
        'FAIL worker /health part api, needs worker',
        'FAIL pages /health body is not the health envelope: not json',
      ].join('\n')
    );
  });

  it('names a part whose /health gives no answer, beside the parts that answer', async () => {
    const run: Run = async (_cmd, args) =>
      args.includes('api')
        ? { code: 1, stdout: '', stderr: 'TypeError: fetch failed' }
        : { code: 0, stdout: body({ ...OK, part: 'mcp' }) };
    await expect(assertHealthBodies(run, { project: 'p' }, ['api', 'mcp'], SHA)).rejects.toThrow(
      /^FAIL api \/health body is not the health envelope: no answer: TypeError: fetch failed$/
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

  it('prints one line for a degraded part and goes on', async () => {
    const bodies = {
      mcp: body({ ...OK, part: 'mcp', status: 'degraded', checks: { a: 'degraded' } }),
    };
    const lines: string[] = [];
    const run = fakeDocker({}, { bodies }).run;
    await up({ dir: await probeDir(), env: ENV, onLine: (l) => void lines.push(l) }, { run });
    expect(lines.filter((l) => l.startsWith('degraded'))).toEqual([
      expect.stringMatching(/^degraded mcp +a degraded$/),
    ]);
  });

  it('stops up after docker reports healthy when a body does not match', async () => {
    const bodies = { mcp: body({ ...OK, part: 'mcp', commit: '0'.repeat(40) }) };
    const docker = fakeDocker({}, { bodies });
    await expect(up({ dir: await probeDir(), env: ENV }, { run: docker.run })).rejects.toThrow(
      `FAIL mcp /health commit ${'0'.repeat(40)}, needs ${SHA}`
    );
  });
});
