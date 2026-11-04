import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { createLog, type Log } from '../log/log.js';
import { type Store } from '../store/store.types.js';

export type ServerPartKind = 'pages' | 'api' | 'mcp' | 'worker';

export type SettingValue = string | number | boolean;

export interface ExtensionInfo {
  id: string;
  version: string;
  part: ServerPartKind;
  origin: string;
  commit: string;
}

// The kit 0.2 subset of the host ctx; auth, secrets and spans arrive in later versions.
export interface PartContext {
  readonly extension: Readonly<ExtensionInfo>;
  readonly log: Log;
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly store: Store;
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
  return Object.freeze({ extension, log, settings, store: store ?? NO_STORE });
};
