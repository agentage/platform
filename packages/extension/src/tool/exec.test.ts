import { describe, expect, it } from 'vitest';
import { mustRun, runCommand } from './exec.js';

describe('exec', () => {
  it('captures stdout and the exit code', async () => {
    const ok = await runCommand(process.execPath, ['-e', 'process.stdout.write("hi")'], {
      echo: false,
    });
    expect(ok).toEqual({ code: 0, stdout: 'hi' });
    const failed = await runCommand(process.execPath, ['-e', 'process.exit(3)']);
    expect(failed.code).toBe(3);
  });

  it('mustRun throws on a non-zero exit, runCommand on a missing binary', async () => {
    await expect(mustRun(runCommand, process.execPath, ['-e', 'process.exit(2)'])).rejects.toThrow(
      /exit code 2/
    );
    await expect(runCommand('agentage-no-such-binary', [])).rejects.toThrow(/ENOENT/);
  });
});
