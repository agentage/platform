import { type Server } from 'node:http';
import { createContext, type ServerPartKind } from '../context/context.js';
import { settingsFromEnv } from '../context/settings.js';
import { DEFAULT_RECORD_FILE, loadRecord } from '../discovery/discovery.js';
import { type HealthCheck } from '../health/health.js';
import { createLog, type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { imageParts, normalizeParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { readManifest } from '../manifest/read-manifest.js';
import { serve, type ServeOptions } from '../server/serve.js';
import { createStore, storeCheck } from '../store/store.js';
import { buildInfoFromEnv, portFromEnv, type Env } from './build-info.js';
import { RUNNERS, type RunnerInput } from './part-runners.js';

export { createOf } from './part-runners.js';

export interface RunPartOptions {
  dir: string;
  part: string;
  env: Env;
  importModule?: (file: string) => Promise<unknown>;
  serve?: Pick<ServeOptions, 'signals' | 'exit'>;
}

const recordFor = async (env: Env, log: Log) => {
  const file = env['AGENTAGE_RECORD_FILE'] || DEFAULT_RECORD_FILE;
  const record = await loadRecord(file);
  if (!record) log.warn('no release record mounted; discovery lists this image by tag', { file });
  return record;
};

export const partOf = (pkg: ExtensionPackage, part: string): ImagePartKind => {
  const parts: string[] = imageParts(pkg);
  if (!parts.includes(part)) throw new Error(`part ${part} is not an image part of this manifest`);
  return part as ImagePartKind;
};

// ui serves files and gets no ctx; every other part gets the store when the manifest has postgres.
const storeFor = (pkg: ExtensionPackage, part: ImagePartKind, env: Env, log: Log) =>
  part !== 'ui' && normalizeParts(pkg.agentage.parts).store === 'postgres'
    ? createStore(env, log)
    : undefined;

const inputFor = async (
  options: RunPartOptions,
  pkg: ExtensionPackage,
  part: ImagePartKind,
  log: Log
) => {
  const { env } = options;
  const origin = env['AGENTAGE_ORIGIN'] || undefined;
  const build = buildInfoFromEnv(env);
  const store = storeFor(pkg, part, env, log);
  const settings = settingsFromEnv(pkg, env, log);
  const ctxOrigin = origin ?? `http://127.0.0.1:${portFromEnv(env)}`;
  const ctxPart = (part === 'ui' ? 'pages' : part) as ServerPartKind;
  const ctx = createContext({
    pkg,
    part: ctxPart,
    origin: ctxOrigin,
    commit: build.commit,
    log,
    settings,
    store,
  });
  const record = await recordFor(env, log);
  const checks: Record<string, HealthCheck> = store ? { store: storeCheck(store) } : {};
  const base = { pkg, build, log, record, origin, ownImage: env['AGENTAGE_IMAGE'], checks };
  return {
    dir: options.dir,
    pkg,
    ctx,
    base,
    importModule: options.importModule,
  } satisfies RunnerInput;
};

export const runPart = async (options: RunPartOptions): Promise<Server> => {
  const pkg = await readManifest(options.dir);
  const part = partOf(pkg, options.part);
  const log = createLog({ extension: pkg.agentage.id, part });
  const { app, stop } = await RUNNERS[part](await inputFor(options, pkg, part, log));
  if (stop)
    for (const signal of options.serve?.signals ?? ['SIGTERM', 'SIGINT'])
      process.once(signal, stop);
  return serve({ app, port: portFromEnv(options.env), log, ...options.serve });
};
