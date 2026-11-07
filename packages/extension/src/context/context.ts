import { callerOf, type Caller } from '../auth/token-check.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { createLog, type Log } from '../log/log.js';
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
}

// The kit's subset of the host ctx; spans arrive in a later version.
export interface PartContext {
  readonly extension: Readonly<ExtensionInfo>;
  // api only: who called, as the token check found it; null on a public route and in other parts.
  readonly auth: { caller(request: object): Caller | null };
  readonly log: Log;
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly store: Store;
  readonly secrets: Secrets;
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
}

export const createContext = (input: ContextInput): PartContext => {
  const { pkg, part, origin, commit, store } = input;
  const extension = Object.freeze({
    id: pkg.agentage.id,
    version: pkg.version,
    part,
    origin,
    commit,
  });
  const log = input.log ?? createLog({ extension: pkg.agentage.id, part });
  const settings = Object.freeze({ ...settingDefaults(pkg), ...input.settings });
  const auth = Object.freeze({ caller: callerOf });
  const secrets = input.secrets ?? {};
  return Object.freeze({ extension, auth, log, settings, store: store ?? NO_STORE, secrets });
};
