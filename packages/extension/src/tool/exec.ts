import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { type Readable } from 'node:stream';
import { KILL_GRACE_MS, TIMEOUTS } from './timeouts.js';

export interface RunOptions {
  cwd?: string;
  echo?: boolean;
  // Capture stderr instead of streaming it: `up` prints its own lines, the tail only on failure.
  quiet?: boolean;
  env?: Record<string, string | undefined>;
  // Default TIMEOUTS.command; past it the command is killed and the call rejects.
  timeoutMs?: number;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr?: string;
}

export type Run = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

type Child = ChildProcessByStdio<null, Readable, Readable | null>;

const spawnFor = (command: string, args: string[], options: RunOptions): Child =>
  spawn(command, args, {
    cwd: options.cwd,
    stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'],
    env: options.env ? { ...process.env, ...options.env } : process.env,
  }) as Child;

// Resolves true once the command is past its time and has been told to stop.
const expiry = (child: Child, ms: number) => {
  let timer: NodeJS.Timeout | undefined;
  const expired = { value: false };
  timer = setTimeout(() => {
    expired.value = true;
    child.kill('SIGTERM');
    timer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS).unref();
  }, ms).unref();
  return { expired, clear: () => clearTimeout(timer) };
};

const timedOut = (command: string, args: string[], ms: number): Error =>
  new Error(`${command} ${args[0] ?? ''} did not finish in ${Math.round(ms / 1000)} s`);

// stdout is captured (and echoed to stderr with `echo`); stderr streams through as progress.
export const runCommand: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawnFor(command, args, options);
    const ms = options.timeoutMs ?? TIMEOUTS.command;
    const timer = expiry(child, ms);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (options.echo) process.stderr.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
    child.on('error', (err: NodeJS.ErrnoException) => {
      timer.clear();
      reject(err.code === 'ENOENT' ? new Error(`${command} is not installed or not on PATH`) : err);
    });
    child.on('close', (code) => {
      timer.clear();
      if (timer.expired.value) return reject(timedOut(command, args, ms));
      resolve({ code: code ?? 1, stdout, ...(options.quiet ? { stderr } : {}) });
    });
  });

const tail = (text: string | undefined): string =>
  text ? `\n${text.trim().split('\n').slice(-15).join('\n')}` : '';

export const mustRun = async (
  run: Run,
  command: string,
  args: string[],
  options?: RunOptions
): Promise<string> => {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args[0] ?? ''} failed with exit code ${result.code}${tail(result.stderr)}`
    );
  }
  return result.stdout;
};

// Every command a runner starts runs quiet: what `up` and `down` print are their own lines.
export const quietly =
  (run: Run): Run =>
  (command, args, options) =>
    run(command, args, { ...options, quiet: true });
