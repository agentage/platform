import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mustRun, runCommand } from './exec.js';
import { KILL_GRACE_MS, TIMEOUTS } from './timeouts.js';

// Real spawns, except where a test swaps in a child that only records the signals it gets.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<{ spawn: typeof spawn }>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const fakeChild = () => {
  const signals: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: null,
    kill: (signal: string) => signals.push(signal) > 0,
  });
  vi.mocked(spawn).mockImplementationOnce((() => child) as unknown as typeof spawn);
  return { child, signals };
};

afterEach(() => void vi.useRealTimers());

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
      `${process.execPath} -e failed with exit code 2`
    );
    await expect(runCommand('agentage-no-such-binary', [])).rejects.toThrow(
      'agentage-no-such-binary is not installed or not on PATH'
    );
  });
});

describe('exec timeouts', () => {
  it('kills a real command past its timeout and names it', async () => {
    const started = Date.now();
    const hang = runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 200,
    });
    await expect(hang).rejects.toThrow(`${process.execPath} -e did not finish in 0 s`);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('sends SIGTERM at the bound, SIGKILL one grace period later, then rejects', async () => {
    vi.useFakeTimers();
    const { child, signals } = fakeChild();
    const call = runCommand('docker', ['compose', 'up'], { timeoutMs: 2000 });
    vi.advanceTimersByTime(1999);
    expect(signals).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(signals).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(KILL_GRACE_MS - 1);
    expect(signals).toEqual(['SIGTERM']);
    vi.advanceTimersByTime(1);
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
    child.emit('close', null);
    await expect(call).rejects.toThrow('docker compose did not finish in 2 s');
  });

  it('bounds a call that names no timeout by TIMEOUTS.command', async () => {
    vi.useFakeTimers();
    const { child, signals } = fakeChild();
    const call = runCommand('docker', ['ps']);
    vi.advanceTimersByTime(TIMEOUTS.command - 1);
    expect(signals).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(signals).toEqual(['SIGTERM']);
    child.emit('close', null);
    await expect(call).rejects.toThrow('docker ps did not finish in 120 s');
  });

  it('a command that ends in time keeps its result and is never signalled', async () => {
    vi.useFakeTimers();
    const { child, signals } = fakeChild();
    const call = runCommand('docker', ['ps'], { timeoutMs: 2000 });
    child.stdout.emit('data', Buffer.from('ok'));
    child.emit('close', 0);
    vi.advanceTimersByTime(2000 + KILL_GRACE_MS);
    expect(signals).toEqual([]);
    await expect(call).resolves.toEqual({ code: 0, stdout: 'ok' });
  });
});
