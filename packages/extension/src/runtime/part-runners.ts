import { join } from 'node:path';
import { generatedOpenapi } from '../api/openapi-doc.js';
import { type Express } from 'express';
import { type PartContext } from '../context/context.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { loadCreate, type ImportModule } from '../manifest/entry.js';
import { hasStore } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { createSpan } from '../log/span.js';
import { createMcpApp } from '../mcp/mcp-app.js';
import { createToolRegistry } from '../mcp/tools.js';
import { createPagesApp, platformSources } from '../pages/pages-app.js';
import { type PagesSite } from '../pages/pages.js';
import { createApiApp, createPartApp, type PartAppBase } from '../server/app.js';
import { mountApi } from '../server/api-routes.js';
import { type Env } from './build-info.js';
import { createUiApp } from '../ui/ui-app.js';
import { runLog } from '../worker/run-log.js';
import { memoryRuns, storeRuns } from '../worker/runs.js';
import { createScheduler } from '../worker/scheduler.js';

export interface RunnerInput {
  dir: string;
  pkg: ExtensionPackage;
  env: Env;
  ctx: () => PartContext;
  base: PartAppBase;
  openapi: Record<string, unknown> | null;
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
  const ctx = input.ctx();
  const { router, routes, documents } = await mountApi(ctx, (api) => callCreate(input, 'api', api));
  // Declared routes guard at their own scope, whatever the committed file says.
  const openapi = routes.length > 0 ? generatedOpenapi(input.pkg, routes) : input.openapi;
  return { app: createApiApp({ ...input.base, router, routes, openapi, wellKnown: documents }) };
};

const mcp = async (input: RunnerInput): Promise<Running> => {
  const registry = createToolRegistry();
  const ctx = input.ctx();
  await callCreate(input, 'mcp', { ...ctx, tool: registry.tool });
  const listing = ctx.settings['mcp.listing'] === 'token' ? 'token' : 'open';
  return { app: createMcpApp({ ...input.base, tools: registry.tools, listing }) };
};

const pages = async (input: RunnerInput): Promise<Running> => {
  const site = (await callCreate(input, 'pages', input.ctx())) as PagesSite;
  return { app: createPagesApp({ ...input.base, site, platform: platformSources(input.env) }) };
};

const ui = async (input: RunnerInput): Promise<Running> => ({
  app: createUiApp({
    ...input.base,
    dir: join(input.dir, 'dist', 'ui'),
    devIssuer: input.env['AGENTAGE_DEV_ISSUER'],
  }),
});

const worker = async (input: RunnerInput): Promise<Running> => {
  const ctx = input.ctx();
  const log = runLog(ctx.log);
  const runs = hasStore(input.pkg, 'postgres') ? storeRuns(ctx.store) : memoryRuns();
  const scheduler = createScheduler({ runs, log });
  await callCreate(input, 'worker', {
    ...ctx,
    log,
    span: createSpan(log),
    schedule: scheduler.schedule,
  });
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
