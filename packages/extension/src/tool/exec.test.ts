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
    await expect(runCommand('agentage-no-such-binary', [])).rejects.toThrow(
      'agentage-no-such-binary is not installed or not on PATH'
    );
  });
});

describe('exec timeouts', () => {
  it('kills a command past its timeout and names it', async () => {
    const started = Date.now();
    const hang = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 200,
    });
    await expect(hang).rejects.toThrow(/did not finish in 0 s/);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('kills a command that ignores SIGTERM after the grace period', async () => {
    const stubborn = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
    const hang = runCommand(process.execPath, ['-e', stubborn], { timeoutMs: 100 });
    await expect(hang).rejects.toThrow(/did not finish/);
  }, 15_000);

  it('a command that ends in time keeps its result', async () => {
    const ok = await runCommand(process.execPath, ['-e', 'process.stdout.write("ok")'], {
      timeoutMs: 10_000,
    });
    expect(ok).toEqual({ code: 0, stdout: 'ok' });
  });
});
