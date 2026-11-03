import { spawn } from 'node:child_process';

export interface RunOptions {
  cwd?: string;
  echo?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
}

export type Run = (command: string, args: string[], options?: RunOptions) => Promise<RunResult>;

// stdout is captured (and echoed to stderr with `echo`); stderr streams through as progress.
export const runCommand: Run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (options.echo) process.stderr.write(chunk);
    });
    child.on('error', (err: NodeJS.ErrnoException) =>
      reject(err.code === 'ENOENT' ? new Error(`${command} is not installed or not on PATH`) : err)
    );
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });

export const mustRun = async (
  run: Run,
  command: string,
  args: string[],
  options?: RunOptions
): Promise<string> => {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} failed with exit code ${result.code}`);
  }
  return result.stdout;
};
