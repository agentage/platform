import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { type Readable } from 'node:stream';

export interface RunOptions {
  cwd?: string;
  echo?: boolean;
  // Capture stderr instead of streaming it: `up` prints its own lines, the tail only on failure.
  quiet?: boolean;
  env?: Record<string, string | undefined>;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr?: string;
}

export type Run = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

// stdout is captured (and echoed to stderr with `echo`); stderr streams through as progress.
export const runCommand: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const stdio = ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'] as const;
    const env = options.env ? { ...process.env, ...options.env } : process.env;
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: [...stdio],
      env,
    }) as ChildProcessByStdio<null, Readable, Readable | null>;
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (options.echo) process.stderr.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => void (stderr += chunk.toString()));
    child.on('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'ENOENT' ? new Error(`${command} is not installed or not on PATH`) : err)
    );
    child.on('close', (code) =>
      resolve({ code: code ?? 1, stdout, ...(options.quiet ? { stderr } : {}) })
    );
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
