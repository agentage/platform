import { type Server } from 'node:http';
import { hostname } from 'node:os';
import { createContext, type PartContext, type ServerPartKind } from '../context/context.js';
import { readSecrets, SECRETS_DIR, type Secrets } from '../context/secrets.js';
import { settingsFromEnv } from '../context/settings.js';
import { DEFAULT_RECORD_FILE, loadRecord } from '../discovery/discovery.js';
import { type ExtensionRecord } from '../discovery/discovery.schema.js';
import { declaredScopes, partAuth, platformOf } from '../auth/part-auth.js';
import { readOpenapi } from '../discovery/openapi.js';
import { createLog, type Log } from '../log/log.js';
import { type HealthCheck } from '../health/health.js';
import { type ImportModule } from '../manifest/entry.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasStore, imageParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { readManifest } from '../manifest/read-manifest.js';
import { type PartAppBase } from '../server/app.js';
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
  secretsDir?: string;
  serve?: Pick<ServeOptions, 'signals' | 'exit'>;
}

type Openapi = Record<string, unknown> | null;

interface Start {
  pkg: ExtensionPackage;
  part: ImagePartKind;
  env: Env;
  log: Log;
  secrets: Secrets;
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
  part !== 'ui' && hasStore(pkg, 'postgres') ? createStore(env, log) : undefined;

const contextFor = (
  start: Start,
  part: ServerPartKind,
  store: Store | undefined,
  checks: Record<string, HealthCheck>
) =>
  createContext({
    pkg: start.pkg,
    part,
    origin: start.env['AGENTAGE_ORIGIN'] || `http://127.0.0.1:${portFromEnv(start.env)}`,
    commit: buildInfoFromEnv(start.env).commit,
    log: start.log,
    settings: settingsFromEnv(start.pkg, start.env, start.log),
    store,
    secrets: start.secrets,
    platform: platformOf(start.env),
    checks,
  });

// Built on first use, so the ui runner, which never asks, has no ctx at all.
const lazyContext = (
  start: Start,
  store: Store | undefined,
  checks: Record<string, HealthCheck>
): (() => PartContext) => {
  let ctx: PartContext | undefined;
  return () => {
    if (start.part === 'ui') throw new Error('the ui part gets no ctx');
    return (ctx ??= contextFor(start, start.part, store, checks));
  };
};

const guardFor = async (start: Start, openapi: Openapi, record: ExtensionRecord | null) => {
  if (start.part !== 'api' && start.part !== 'mcp') return { checks: {} };
  const { id } = start.pkg.agentage;
  return partAuth(start.env, id, start.log, declaredScopes(id, openapi, record?.tools));
};

const baseFor = async (start: Start, store: Store | undefined, openapi: Openapi) => {
  const { pkg, env, log } = start;
  const record = await recordFor(env, log);
  const guard: Partial<PartAppBase> = await guardFor(start, openapi, record);
  return {
    pkg,
    log,
    record,
    ...guard,
    checks: { ...(store ? { store: storeCheck(store) } : {}), ...guard.checks },
    build: buildInfoFromEnv(env),
    origin: env['AGENTAGE_ORIGIN'] || undefined,
    ownImage: env['AGENTAGE_IMAGE'],
  };
};

const inputFor = async (options: RunPartOptions, start: Start): Promise<RunnerInput> => {
  const store = storeFor(start);
  const openapi = await readOpenapi(options.dir);
  const base = await baseFor(start, store, openapi);
  return {
    dir: options.dir,
    pkg: start.pkg,
    env: start.env,
    ctx: lazyContext(start, store, base.checks),
    base,
    openapi,
    importModule: options.importModule,
  };
};

let running: Log | undefined;

// The running part's log, so a crash in the image entry is an error row of that part.
export const partLog = (): Log | undefined => running;

export const runPart = async (options: RunPartOptions): Promise<Server> => {
  const pkg = await readManifest(options.dir);
  const part = partOf(pkg, options.part);
  const log = createLog({ extension: pkg.agentage.id, part, version: pkg.version });
  running = log;
  const names = part === 'ui' ? [] : (pkg.agentage.secrets ?? []);
  const secrets = await readSecrets(names, options.secretsDir ?? SECRETS_DIR, part);
  const start = { pkg, part, env: options.env, log, secrets };
  const { app, stop } = await RUNNERS[part](await inputFor(options, start));
  if (stop)
    for (const signal of options.serve?.signals ?? ['SIGTERM', 'SIGINT'])
      process.once(signal, stop);
  const server = await serve({ app, port: portFromEnv(options.env), log, ...options.serve });
  const { commit } = buildInfoFromEnv(options.env);
  log.event('startup', {
    'agentage.startup.commit': commit,
    'agentage.startup.instance': hostname(),
  });
  return server;
};
