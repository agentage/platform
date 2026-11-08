import { callerOf, type Caller } from '../auth/token-check.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { storeOf } from '../manifest/parts.js';
import { type StoreKind } from '../manifest/primitives.schema.js';
import { createLog, type Log } from '../log/log.js';
import { createSpan, type Span } from '../log/span.js';
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
}

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
  });
};
