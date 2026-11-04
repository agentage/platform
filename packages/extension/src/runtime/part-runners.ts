import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Express } from 'express';
import { type PartContext } from '../context/context.js';
import { readOpenapi } from '../discovery/openapi.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { entryOf, normalizeParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { createMcpApp } from '../mcp/mcp-app.js';
import { createToolRegistry } from '../mcp/tools.js';
import { createPagesApp } from '../pages/pages-app.js';
import { createApiApp, createPartApp, type PartAppBase } from '../server/app.js';
import { type ApiHandler } from '../server/part.types.js';
import { createUiApp } from '../ui/ui-app.js';
import { runLog } from '../worker/run-log.js';
import { memoryRuns, storeRuns } from '../worker/runs.js';
import { createScheduler } from '../worker/scheduler.js';

export interface RunnerInput {
  dir: string;
  pkg: ExtensionPackage;
  ctx: PartContext;
  base: PartAppBase;
  importModule?: (file: string) => Promise<unknown>;
}

export interface Running {
  app: Express;
  stop?: () => void;
}

type PartCreate = (ctx: never) => unknown;

const importFile = (file: string): Promise<unknown> => import(pathToFileURL(file).href);

export const createOf = (mod: unknown, file: string): PartCreate => {
  const create = (mod as { create?: unknown } | null)?.create;
  if (typeof create !== 'function') throw new Error(`${file} does not export create(ctx)`);
  return create as PartCreate;
};

// Imports the part's entry and calls its create(ctx); ui has no code to run.
const callCreate = async <C>(input: RunnerInput, part: ImagePartKind, ctx: C): Promise<unknown> => {
  const file = join(input.dir, entryOf(input.pkg, part));
  const mod = await (input.importModule ?? importFile)(file);
  return (createOf(mod, file) as (ctx: C) => unknown)(ctx);
};

const api = async (input: RunnerInput): Promise<Running> => {
  const router = (await callCreate(input, 'api', input.ctx)) as ApiHandler;
  const openapi = await readOpenapi(input.dir);
  return { app: createApiApp({ ...input.base, router, openapi }) };
};

const mcp = async (input: RunnerInput): Promise<Running> => {
  const registry = createToolRegistry();
  await callCreate(input, 'mcp', { ...input.ctx, tool: registry.tool });
  const listing = input.ctx.settings['mcp.listing'] === 'token' ? 'token' : 'open';
  return { app: createMcpApp({ ...input.base, tools: registry.tools, listing }) };
};

const pages = async (input: RunnerInput): Promise<Running> => {
  const site = (await callCreate(input, 'pages', input.ctx)) as Record<string, string>;
  return { app: createPagesApp({ ...input.base, site }) };
};

const ui = async (input: RunnerInput): Promise<Running> => ({
  app: createUiApp({ ...input.base, dir: join(input.dir, 'dist', 'ui') }),
});

const worker = async (input: RunnerInput): Promise<Running> => {
  const log = runLog(input.ctx.log);
  const hasStore = normalizeParts(input.pkg.agentage.parts).store === 'postgres';
  const runs = hasStore ? storeRuns(input.ctx.store) : memoryRuns();
  const scheduler = createScheduler({ runs, log });
  await callCreate(input, 'worker', { ...input.ctx, log, schedule: scheduler.schedule });
  const checks = { ...input.base.checks, ...scheduler.checks() };
  scheduler.start();
  return {
    app: createPartApp({ ...input.base, checks, part: 'worker', mount: () => undefined }),
    stop: scheduler.stop,
  };
};

export const RUNNERS: Record<ImagePartKind, (input: RunnerInput) => Promise<Running>> = {
  api,
  mcp,
  pages,
  ui,
  worker,
};
