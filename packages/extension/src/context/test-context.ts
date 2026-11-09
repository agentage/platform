import { createRouteRegistry, type RouteEntry, type RouteRegistrar } from '../api/routes.js';
import { type WellKnownRegistrar } from '../api/well-known.js';
import type { HealthCheck } from '../health/health.js';
import { type Log } from '../log/log.js';
import { createSpan, type SpanRecord } from '../log/span.js';
import { createToolRegistry, type ToolEntry, type ToolRegistrar } from '../mcp/tools.js';
import { migrate } from '../store/migrations.js';
import { createTestStore, type TestStore } from '../store/test-store.js';
import { type JobOptions } from '../worker/job-options.js';
import { runLog } from '../worker/run-log.js';
import { type JobRun, memoryRuns } from '../worker/runs.js';
import { createScheduler, type Schedule } from '../worker/scheduler.js';
import { type StoreKind } from '../manifest/primitives.schema.js';
import {
  NO_PLATFORM,
  healthRegistrar,
  NO_STORE,
  type ExtensionInfo,
  type PlatformInfo,
  type PartContext,
  type SettingValue,
} from './context.js';
import { packageExtension } from './package-extension.js';
import { recordingLog, type LogEntry } from './recording-log.js';
import {
  commandContext,
  type TestCommandContext,
  type TestCommandOptions,
} from './test-command-context.js';

export { type LogEntry } from './recording-log.js';
export {
  type ClientCall,
  type TestCommandContext,
  type TestCommandOptions,
} from './test-command-context.js';

export interface TestContext extends PartContext {
  readonly logs: LogEntry[];
  close(): Promise<void>;
  readonly schedule: Schedule;
  readonly tool: ToolRegistrar;
  readonly tools: ToolEntry[];
  readonly route: RouteRegistrar;
  readonly routes: RouteEntry[];
  readonly wellKnown: WellKnownRegistrar;
  readonly jobs: ScheduledJob[];
  readonly spans: SpanRecord[];
  // When each ctx.exit() was called; a test context never exits.
  readonly exits: number[];
  // Each ctx.health(name, check) registration.
  readonly checks: Record<string, HealthCheck>;
  runJob(name: string): Promise<JobRun | undefined>;
}

export interface ScheduledJob {
  name: string;
  cron: string;
  options?: JobOptions;
}

export interface TestContextOptions {
  extension?: Partial<ExtensionInfo>;
  settings?: Record<string, SettingValue>;
  secrets?: Record<string, string>;
  // A throwaway postgres with the package's migrations/ and seeds/ applied (dir: the package root);
  // on by default when ./package.json declares a postgres store, false turns it off.
  store?: boolean | { dir: string };
  platform?: PlatformInfo;
}

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
  const jobs: ScheduledJob[] = [];
  const schedule: Schedule = (name, cron, job, options) => {
    scheduler.schedule(name, cron, job, options);
    jobs.push({ name, cron, options });
  };
  return {
    ...createToolRegistry(),
    ...createRouteRegistry(),
    schedule,
    jobs,
    runJob: scheduler.run,
  };
};

// ./package.json's identity and store kind; its postgres store opens a test store unless store is false.
const identityOf = (options: TestContextOptions) => {
  const { store: kind, ...identity } = packageExtension();
  const store = options.store ?? kind === 'postgres';
  // An open test store is postgres; a closed one hides postgres but keeps a kind it cannot serve.
  const closedKind = kind === 'postgres' ? undefined : kind;
  const own: StoreKind | undefined = store ? 'postgres' : closedKind;
  const extension = { ...TEST_EXTENSION, ...identity, ...(own && { store: own }) };
  return { store, extension: { ...extension, ...options.extension } };
};

const serverContext = (options: TestContextOptions): TestContext => {
  const logs: LogEntry[] = [];
  const log = runLog(recordingLog(logs));
  const spans: SpanRecord[] = [];
  const { extension, ...open } = identityOf(options);
  const store = testStore(open.store, recordingLog([]));
  const caller = { sub: 'usr_test', scopes: [`${extension.id}:read`] };
  const exits: number[] = [];
  const checks: Record<string, HealthCheck> = {};
  return {
    extension,
    auth: { caller: () => caller },
    log,
    logs,
    span: createSpan(log, spans),
    spans,
    settings: { ...options.settings },
    store: store ?? NO_STORE,
    secrets: Object.freeze({ ...options.secrets }),
    platform: Object.freeze({ ...(options.platform ?? NO_PLATFORM) }),
    exits,
    exit: () => void exits.push(Date.now()),
    checks,
    health: healthRegistrar(checks),
    close: async () => store?.close(),
    ...recorders(log),
  };
};

// A ctx for unit tests: identity from ./package.json, recorded logs, spans, jobs, tools and routes; with `args`, a command ctx.
export function createTestContext(options: TestCommandOptions): TestCommandContext;
export function createTestContext(options?: TestContextOptions): TestContext;
export function createTestContext(options: TestContextOptions | TestCommandOptions = {}) {
  return 'args' in options ? commandContext(options) : serverContext(options);
}
