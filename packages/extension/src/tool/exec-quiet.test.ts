import { describe, expect, it } from 'vitest';
import { mustRun, quietly, runCommand, type Run, type RunOptions } from './exec.js';

describe('exec quiet', () => {
  it('quiet captures stderr instead of streaming it, and env adds to the process env', async () => {
    const script =
      'process.stderr.write("progress"); process.stdout.write(process.env.AGENTAGE_X ?? "")';
    const result = await runCommand(process.execPath, ['-e', script], {
      quiet: true,
      env: { AGENTAGE_X: 'set' },
    });
    expect(result).toEqual({ code: 0, stdout: 'set', stderr: 'progress' });
  });

  it('mustRun puts the last 15 lines of a captured stderr into the error', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const run: Run = async () => ({ code: 7, stdout: '', stderr: `${lines}\n` });
    const message = await mustRun(run, 'docker', ['compose', 'up']).then(
      String,
      (err: Error) => err.message
    );
    expect(message.split('\n')).toEqual([
      'docker compose failed with exit code 7',
      ...Array.from({ length: 15 }, (_, i) => `line ${i + 6}`),
    ]);
  });

  it('quietly forces quiet on every call and keeps the other options', async () => {
    const seen: (RunOptions | undefined)[] = [];
    const run: Run = async (_command, _args, options) => (
      seen.push(options),
      { code: 0, stdout: '' }
    );
    await quietly(run)('docker', ['ps'], { cwd: '/x' });
    await quietly(run)('docker', ['ps']);
    expect(seen).toEqual([{ cwd: '/x', quiet: true }, { quiet: true }]);
  });
});
