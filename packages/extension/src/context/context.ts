import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { createLog, type Log, type LogFields, type LogLevel } from '../log/log.js';

export type ServerPartKind = 'pages' | 'api' | 'mcp' | 'worker';

export type SettingValue = string | number | boolean;

export interface ExtensionInfo {
  id: string;
  version: string;
  part: ServerPartKind;
  origin: string;
}

// The kit 0.1 subset of the host ctx; auth, store, secrets and spans arrive in later versions.
export interface PartContext {
  readonly extension: Readonly<ExtensionInfo>;
  readonly log: Log;
  readonly settings: Readonly<Record<string, SettingValue>>;
}

export const settingDefaults = (pkg: ExtensionPackage): Record<string, SettingValue> =>
  Object.fromEntries(
    Object.entries(pkg.agentage.settings ?? {}).map(([key, setting]) => [key, setting.default])
  );

export interface ContextInput {
  pkg: ExtensionPackage;
  part: ServerPartKind;
  origin: string;
  log?: Log;
}

export const createContext = ({ pkg, part, origin, log }: ContextInput): PartContext =>
  Object.freeze({
    extension: Object.freeze({ id: pkg.agentage.id, version: pkg.version, part, origin }),
    log: log ?? createLog({ extension: pkg.agentage.id, part }),
    settings: Object.freeze(settingDefaults(pkg)),
  });

export interface LogEntry {
  level: LogLevel;
  message: string;
  fields: LogFields;
}

export interface TestContext extends PartContext {
  readonly logs: LogEntry[];
}

export interface TestContextOptions {
  extension?: Partial<ExtensionInfo>;
  settings?: Record<string, SettingValue>;
}

const recordingLog = (logs: LogEntry[]): Log => ({
  info: (message, fields = {}) => void logs.push({ level: 'info', message, fields }),
  warn: (message, fields = {}) => void logs.push({ level: 'warn', message, fields }),
  error: (error, fields = {}) =>
    void logs.push({ level: 'error', message: String(error), fields: { ...fields, err: error } }),
});

// A ctx for unit tests: fixed identity, settings as given, a log that records instead of printing.
export const createTestContext = (options: TestContextOptions = {}): TestContext => {
  const logs: LogEntry[] = [];
  const extension = {
    id: 'test',
    version: '0.0.0',
    part: 'api' as const,
    origin: 'http://127.0.0.1',
    ...options.extension,
  };
  return { extension, log: recordingLog(logs), settings: { ...options.settings }, logs };
};
