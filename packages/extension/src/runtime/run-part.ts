import { type Server } from 'node:http';
import { createContext, type PartContext, type ServerPartKind } from '../context/context.js';
import { settingsFromEnv } from '../context/settings.js';
import { DEFAULT_RECORD_FILE, loadRecord } from '../discovery/discovery.js';
import { type TokenCheck } from '../auth/token-check.js';
import { type HealthCheck } from '../health/health.js';
import { createLog, type Log } from '../log/log.js';
import { type ImportModule } from '../manifest/entry.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasPostgres, imageParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { readManifest } from '../manifest/read-manifest.js';
import { serve, type ServeOptions } from '../server/serve.js';
import { createStore, storeCheck } from '../store/store.js';
import { type Store } from '../store/store.types.js';
import { buildInfoFromEnv, portFromEnv, type Env } from './build-info.js';
import { RUNNERS, type RunnerInput } from './part-runners.js';

export interface RunPartOptions {
  dir: string;
  part: string;
  env: Env;
  importModule?: ImportModule;
  serve?: Pick<ServeOptions, 'signals' | 'exit'>;
  // The host's token check for every route and tool; none in kit 0.2 (see auth/token-check.ts).
  tokenCheck?: TokenCheck;
}

interface Start {
  pkg: ExtensionPackage;
  part: ImagePartKind;
  env: Env;
  log: Log;
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
const storeFor = ({ pkg, part, env, log }: Start) =>
  part !== 'ui' && hasPostgres(pkg) ? createStore(env, log) : undefined;

const contextFor = (start: Start, part: ServerPartKind, store: Store | undefined) =>
  createContext({
    pkg: start.pkg,
    part,
    origin: start.env['AGENTAGE_ORIGIN'] || `http://127.0.0.1:${portFromEnv(start.env)}`,
    commit: buildInfoFromEnv(start.env).commit,
    log: start.log,
    settings: settingsFromEnv(start.pkg, start.env, start.log),
    store,
  });

// Built on first use, so the ui runner, which never asks, has no ctx at all.
const lazyContext = (start: Start, store: Store | undefined): (() => PartContext) => {
  let ctx: PartContext | undefined;
  return () => {
    if (start.part === 'ui') throw new Error('the ui part gets no ctx');
    return (ctx ??= contextFor(start, start.part, store));
  };
};

const inputFor = async (options: RunPartOptions, start: Start): Promise<RunnerInput> => {
  const { pkg, env, log } = start;
  const store = storeFor(start);
  const checks: Record<string, HealthCheck> = store ? { store: storeCheck(store) } : {};
  const origin = env['AGENTAGE_ORIGIN'] || undefined;
  const record = await recordFor(env, log);
  const build = buildInfoFromEnv(env);
  const ownImage = env['AGENTAGE_IMAGE'];
  const base = {
    pkg,
    build,
    log,
    record,
    origin,
    ownImage,
    checks,
    tokenCheck: options.tokenCheck,
  };
  return {
    dir: options.dir,
    pkg,
    env,
    ctx: lazyContext(start, store),
    base,
    importModule: options.importModule,
  };
};

export const runPart = async (options: RunPartOptions): Promise<Server> => {
  const pkg = await readManifest(options.dir);
  const part = partOf(pkg, options.part);
  const log = createLog({ extension: pkg.agentage.id, part });
  const start = { pkg, part, env: options.env, log };
  const { app, stop } = await RUNNERS[part](await inputFor(options, start));
  if (stop)
    for (const signal of options.serve?.signals ?? ['SIGTERM', 'SIGINT'])
      process.once(signal, stop);
  return serve({ app, port: portFromEnv(options.env), log, ...options.serve });
};
