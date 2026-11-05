import { describe, expect, it } from 'vitest';
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
    expect(await run()).toMatchObject({ code: 2, log: [], error: [USAGE] });
    expect(await run('build')).toMatchObject({ code: 2, log: [], error: [USAGE] });
    const flag = await run('bundle', '--fast');
    expect(flag.code).toBe(2);
    expect(flag.error).toHaveLength(1);
    expect(flag.error[0]).toMatch(/^Unknown option '--fast'/);
    expect(flag.error[0]?.endsWith(`\n${USAGE}`)).toBe(true);
  });

  it('exits 1 when the bundle fails', async () => {
    const failed = await run('bundle', '--dir', '/nonexistent/extension');
    expect(failed).toMatchObject({ code: 1, log: [] });
    expect(failed.error[0]).toMatch(/^bundle failed: no package.json/);
  });
});
