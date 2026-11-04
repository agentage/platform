import { describe, expect, it } from 'vitest';
import { FIXTURE } from '../test-support/extensions.js';
import { main, USAGE } from './main.js';

const run = async (...argv: string[]) => {
  const out = { log: [] as string[], error: [] as string[] };
  const code = await main(argv, {
    log: (line) => out.log.push(line),
    error: (line) => out.error.push(line),
  });
  return { code, ...out };
};

describe('agentage-widget', () => {
  it('prints usage with --help and exits 0', async () => {
    expect(await run('--help')).toMatchObject({ code: 0, log: [USAGE] });
  });

  it('exits 2 on a missing command, an unknown one or an unknown flag', async () => {
    expect((await run()).code).toBe(2);
    expect((await run('build')).code).toBe(2);
    const flag = await run('bundle', '--fast');
    expect(flag.code).toBe(2);
    expect(flag.error[0]).toContain(USAGE);
  });

  it('exits 1 when the bundle fails', async () => {
    const failed = await run('bundle', '--dir', '/nonexistent/extension');
    expect(failed).toMatchObject({ code: 1 });
    expect(failed.error[0]).toMatch(/^bundle failed: no package.json/);
  });

  it('bundles and prints one line per file', async () => {
    const done = await run('bundle', '--dir', FIXTURE);
    expect(done.code).toBe(0);
    expect(done.log.map((line) => line.split(/\s+/)[0])).toEqual(['module', 'widgets', 'harness']);
    expect(done.log[1]).toContain('probe-echo');
  }, 60_000);
});
