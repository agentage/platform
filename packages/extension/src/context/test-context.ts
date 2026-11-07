import { type CliContext } from '../command/command.types.js';
import { createOut } from '../command/out.js';
import { messageOf, type Log, type LogFields, type LogLevel } from '../log/log.js';
import { createToolRegistry, type ToolEntry, type ToolRegistrar } from '../mcp/tools.js';
import { migrate } from '../store/migrations.js';
import { createTestStore, type TestStore } from '../store/test-store.js';
import { runLog } from '../worker/run-log.js';
import { type JobRun, memoryRuns } from '../worker/runs.js';
import { createScheduler, type Schedule } from '../worker/scheduler.js';
import { NO_STORE, type ExtensionInfo, type PartContext, type SettingValue } from './context.js';
import { type ArgValue } from '../command/args.js';

export interface LogEntry {
  level: LogLevel;
  message: string;
  fields: LogFields;
}

export interface TestContext extends PartContext {
  readonly logs: LogEntry[];
  close(): Promise<void>;
  readonly schedule: Schedule;
  readonly tool: ToolRegistrar;
  readonly tools: ToolEntry[];
  runJob(name: string): Promise<JobRun | undefined>;
}

export interface TestCommandContext extends CliContext {
  readonly output: { stdout: string[]; stderr: string[] };
  readonly exitCode: number | undefined;
}

export interface TestContextOptions {
  extension?: Partial<ExtensionInfo>;
  settings?: Record<string, SettingValue>;
  secrets?: Record<string, string>;
  // A throwaway postgres with the package's migrations/ and seeds/ applied (dir: the package root).
  store?: boolean | { dir: string };
}

export interface TestCommandOptions {
  args: Record<string, ArgValue>;
  extension?: { id?: string; version?: string };
  json?: boolean;
}

const recordingLog = (logs: LogEntry[]): Log => ({
  info: (message, fields = {}) => void logs.push({ level: 'info', message, fields }),
  warn: (message, fields = {}) => void logs.push({ level: 'warn', message, fields }),
  error: (error, fields = {}) =>
    void logs.push({
      level: 'error',
      message: messageOf(error),
      fields: { ...fields, err: error },
    }),
});

const testStore = (option: TestContextOptions['store'], log: Log): TestStore | undefined => {
  if (!option) return undefined;
  const dir = option === true ? process.cwd() : option.dir;
  return createTestStore((store) => migrate(store, dir, log));
};

const TEST_EXTENSION: ExtensionInfo = {
  id: 'test',
  version: '0.0.0',
  part: 'api',
  origin: 'http://127.0.0.1',
  commit: '0'.repeat(40),
};

// Jobs run by hand with runJob, tools recorded as the mcp part registers them.
const recorders = (log: Log) => {
  const scheduler = createScheduler({ runs: memoryRuns(), log });
  return { ...createToolRegistry(), schedule: scheduler.schedule, runJob: scheduler.run };
};

const serverContext = (options: TestContextOptions): TestContext => {
  const logs: LogEntry[] = [];
  const log = runLog(recordingLog(logs));
  const store = testStore(options.store, recordingLog([]));
  const extension = { ...TEST_EXTENSION, ...options.extension };
  const caller = { sub: 'usr_test', scopes: [`${extension.id}:read`] };
  return {
    extension,
    auth: { caller: () => caller },
    log,
    logs,
    settings: { ...options.settings },
    store: store ?? NO_STORE,
    secrets: Object.freeze({ ...options.secrets }),
    close: async () => store?.close(),
    ...recorders(log),
  };
};

// One recorded line per line written, the trailing newline dropped.
const lines = (into: string[]) => (text: string) =>
  void into.push(...text.replace(/\n$/, '').split('\n'));

const commandContext = (options: TestCommandOptions): TestCommandContext => {
  const output = { stdout: [] as string[], stderr: [] as string[] };
  const out = createOut({
    json: options.json ?? false,
    stdout: lines(output.stdout),
    stderr: lines(output.stderr),
  });
  const extension = { id: 'test', version: '0.0.0', ...options.extension, part: 'cli' as const };
  return {
    extension,
    args: { ...options.args },
    out,
    output,
    get exitCode() {
      return out.exitCode;
    },
  };
};

// A ctx for unit tests: fixed identity, recorded logs, jobs and tools; with `args`, a command ctx.
export function createTestContext(options: TestCommandOptions): TestCommandContext;
export function createTestContext(options?: TestContextOptions): TestContext;
export function createTestContext(options: TestContextOptions | TestCommandOptions = {}) {
  return 'args' in options ? commandContext(options) : serverContext(options);
}
