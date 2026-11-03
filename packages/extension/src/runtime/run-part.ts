import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Server } from 'node:http';
import { createContext, type PartContext } from '../context/context.js';
import { DEFAULT_RECORD_FILE, loadRecord } from '../discovery/discovery.js';
import { createLog, type Log } from '../log/log.js';
import { entryOf } from '../manifest/parts.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { readManifest } from '../manifest/read-manifest.js';
import { createApiApp } from '../server/app.js';
import { type ApiCreate } from '../server/part.types.js';
import { serve, type ServeOptions } from '../server/serve.js';
import { buildInfoFromEnv, portFromEnv, type Env } from './build-info.js';

export interface RunPartOptions {
  dir: string;
  part: string;
  env: Env;
  importModule?: (file: string) => Promise<unknown>;
  serve?: Pick<ServeOptions, 'signals' | 'exit'>;
}

const importFile = (file: string): Promise<unknown> => import(pathToFileURL(file).href);

export const createOf = (mod: unknown, file: string): ApiCreate => {
  const create = (mod as { create?: unknown } | null)?.create;
  if (typeof create !== 'function') throw new Error(`${file} does not export create(ctx)`);
  return create as ApiCreate;
};

const recordFor = async (env: Env, log: Log) => {
  const file = env['AGENTAGE_RECORD_FILE'] || DEFAULT_RECORD_FILE;
  const record = await loadRecord(file);
  if (!record) log.warn('no release record mounted; discovery lists this image by tag', { file });
  return record;
};

const createRouter = async (options: RunPartOptions, ctx: PartContext, pkg: ExtensionPackage) => {
  const file = join(options.dir, entryOf(pkg, 'api'));
  const mod = await (options.importModule ?? importFile)(file);
  return createOf(mod, file)(ctx);
};

const contextFor = (pkg: ExtensionPackage, origin: string | undefined, port: number, log: Log) =>
  createContext({ pkg, part: 'api', origin: origin ?? `http://127.0.0.1:${port}`, log });

export const runPart = async (options: RunPartOptions): Promise<Server> => {
  if (options.part !== 'api') throw new Error(`part ${options.part} is not served by kit 0.1`);
  const { env } = options;
  const pkg = await readManifest(options.dir);
  const log = createLog({ extension: pkg.agentage.id, part: 'api' });
  const port = portFromEnv(env);
  const origin = env['AGENTAGE_ORIGIN'] || undefined;
  const router = await createRouter(options, contextFor(pkg, origin, port, log), pkg);
  const build = buildInfoFromEnv(env);
  const record = await recordFor(env, log);
  const ownImage = env['AGENTAGE_IMAGE'];
  const app = createApiApp({ pkg, build, router, log, record, origin, ownImage });
  return serve({ app, port, log, ...options.serve });
};
