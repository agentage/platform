import { join } from 'node:path';
import { type Express } from 'express';
import { type PartContext } from '../context/context.js';
import { readOpenapi } from '../discovery/openapi.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { loadCreate, type ImportModule } from '../manifest/entry.js';
import { hasPostgres } from '../manifest/parts.js';
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
  importModule?: ImportModule;
}

export interface Running {
  app: Express;
  stop?: () => void;
}

// ui has no code to run; every other part is its create(ctx).
const callCreate = async <C>(input: RunnerInput, part: ImagePartKind, ctx: C): Promise<unknown> =>
  (await loadCreate<C>(input.dir, input.pkg, part, input.importModule))(ctx);

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
  const runs = hasPostgres(input.pkg) ? storeRuns(input.ctx.store) : memoryRuns();
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
