import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ArgValue } from '../command/args.js';
import { type Caller } from '../auth/token-check.js';
import { type CliClient, type CliContext } from '../command/command.types.js';
import { createOut } from '../command/out.js';
import { packageExtension } from './package-extension.js';
import { recordingLog, type LogEntry } from './recording-log.js';

export type ClientCall =
  | { kind: 'api'; method: string; path: string; input?: unknown }
  | { kind: 'tool'; name: string; args?: Record<string, unknown> };

export interface TestCommandContext extends CliContext {
  readonly output: { stdout: string[]; stderr: string[] };
  readonly exitCode: number | undefined;
  readonly logs: LogEntry[];
  // Every ctx.client call in order; the answers come from options.client.
  readonly calls: ClientCall[];
}

export interface TestCommandOptions {
  args: Record<string, ArgValue>;
  extension?: { id?: string; version?: string };
  json?: boolean;
  // null for a run without a signed-in user.
  user?: Caller | null;
  client?: Partial<CliClient>;
}

// One recorded line per line written, the trailing newline dropped.
const lines = (into: string[]) => (text: string) =>
  void into.push(...text.replace(/\n$/, '').split('\n'));

const recordingClient = (calls: ClientCall[], answers: Partial<CliClient> = {}): CliClient => ({
  api: async (method, path, input) => {
    calls.push({ kind: 'api', method, path, ...(input === undefined ? {} : { input }) });
    return answers.api?.(method, path, input);
  },
  tool: async (name, args) => {
    calls.push({ kind: 'tool', name, ...(args === undefined ? {} : { args }) });
    return answers.tool?.(name, args);
  },
});

// A throwaway owner-only folder, made on first read like the real one.
const lazyDir = (): (() => string) => {
  let dir: string | undefined;
  return () => (dir ??= mkdtempSync(join(tmpdir(), 'agentage-cli-')));
};

const recorded = (options: TestCommandOptions) => {
  const output = { stdout: [] as string[], stderr: [] as string[] };
  const json = options.json ?? false;
  const out = createOut({ json, stdout: lines(output.stdout), stderr: lines(output.stderr) });
  return { out, output, logs: [] as LogEntry[], calls: [] as ClientCall[] };
};

export const commandContext = (options: TestCommandOptions): TestCommandContext => {
  const { out, output, logs, calls } = recorded(options);
  const { id = 'test', version = '0.0.0' } = packageExtension();
  const extension = { id, version, ...options.extension, part: 'cli' as const };
  const fixedUser = { sub: 'usr_test', scopes: [`${extension.id}:read`] };
  const dir = lazyDir();
  return {
    ...{ extension, args: { ...options.args }, out, output, logs, calls },
    log: recordingLog(logs),
    user: options.user === undefined ? fixedUser : options.user,
    client: recordingClient(calls, options.client),
    get dir() {
      return dir();
    },
    get exitCode() {
      return out.exitCode;
    },
  };
};
