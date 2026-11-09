import { requestScope } from '../agcid/current.js';
import { callerOf, type Caller } from '../auth/token-check.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { storeOf } from '../manifest/parts.js';
import { type StoreKind } from '../manifest/primitives.schema.js';
import { createLog, type Log } from '../log/log.js';
import { createSpan, type Span } from '../log/span.js';
import type { HealthCheck } from '../health/health.js';
import { type Store } from '../store/store.types.js';
import { type Secrets } from './secrets.js';

export type ServerPartKind = 'pages' | 'api' | 'mcp' | 'worker';

export type SettingValue = string | number | boolean;

export interface ExtensionInfo {
  id: string;
  version: string;
  part: ServerPartKind;
  origin: string;
  commit: string;
  store?: StoreKind;
}

// The platform this deployment trusts: AGENTAGE_ISSUER, AGENTAGE_AUDIENCE, AGENTAGE_TELEMETRY_URL.
export interface PlatformInfo {
  issuer: string;
  audience: string;
  telemetry?: string;
}

export const NO_PLATFORM: PlatformInfo = Object.freeze({ issuer: '', audience: '' });

// The kit's subset of the host ctx.
export interface PartContext {
  readonly extension: Readonly<ExtensionInfo>;
  // api only: who called, as the token check found it; null on a public route and in other parts.
  readonly auth: { caller(request: object): Caller | null };
  readonly log: Log;
  // Times fn as one span line (name, ms, ok); its value and its throw pass through.
  readonly span: Span;
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly store: Store;
  readonly secrets: Secrets;
  readonly platform: Readonly<PlatformInfo>;
  // Shuts the part down (SIGTERM drain) once the current answer is sent; the orchestrator restarts it.
  readonly exit: () => void;
  // Adds a named check to /health (checks.clickhouse, say): ok, degraded or unavailable.
  readonly health: (name: string, check: HealthCheck) => void;
}

const CHECK_NAME = /^[a-z][a-z0-9-]*$/;

export const healthRegistrar =
  (checks: Record<string, HealthCheck>) =>
  (name: string, check: HealthCheck): void => {
    if (!CHECK_NAME.test(name) || name in checks)
      throw new Error(`health check ${name}: taken or not a-z0-9-`);
    checks[name] = check;
  };

// Inside a request: after its answer (server/request-line.ts); outside one: now.
const exitAfterAnswer = (): void => {
  const scope = requestScope.getStore();
  if (scope) scope.exit = true;
  else process.kill(process.pid, 'SIGTERM');
};

// ctx.store is always there; without a store part in the manifest it says so on first use.
export const NO_STORE: Store = {
  query: async () => {
    throw new Error('this extension declares no store: add parts.store to the manifest');
  },
};

export const settingDefaults = (pkg: ExtensionPackage): Record<string, SettingValue> =>
  Object.fromEntries(
    Object.entries(pkg.agentage.settings ?? {}).map(([key, setting]) => [key, setting.default])
  );

export interface ContextInput {
  pkg: ExtensionPackage;
  part: ServerPartKind;
  origin: string;
  commit: string;
  log?: Log;
  settings?: Record<string, SettingValue>;
  store?: Store;
  secrets?: Secrets;
  platform?: PlatformInfo;
  // The part's /health checks, the same object the health handler reads.
  checks?: Record<string, HealthCheck>;
}

export const createContext = (input: ContextInput): PartContext => {
  const { pkg, part, origin, commit, store } = input;
  const kind = storeOf(pkg);
  const extension = Object.freeze({
    id: pkg.agentage.id,
    version: pkg.version,
    part,
    origin,
    commit,
    ...(kind && { store: kind }),
  });
  const log = input.log ?? createLog({ extension: pkg.agentage.id, part, version: pkg.version });
  const settings = Object.freeze({ ...settingDefaults(pkg), ...input.settings });
  const auth = Object.freeze({ caller: callerOf });
  const secrets = input.secrets ?? {};
  const span = createSpan(log);
  const platform = Object.freeze({ ...(input.platform ?? NO_PLATFORM) });
  return Object.freeze({
    extension,
    auth,
    log,
    span,
    settings,
    store: store ?? NO_STORE,
    secrets,
    platform,
    exit: exitAfterAnswer,
    health: healthRegistrar(input.checks ?? {}),
  });
};
