import { type AddressInfo } from 'node:net';
import { type Express } from 'express';
import { type PartContext } from '../context/context.js';
import { createTestContext } from '../context/test-context.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { createMcpApp } from '../mcp/mcp-app.js';
import { callTool } from '../mcp/snapshot.js';
import { createToolRegistry, prefixed, type McpContext } from '../mcp/tools.js';
import { createApiApp } from '../server/app.js';
import { type ApiCreate } from '../server/part.types.js';
import { listen } from '../server/serve.js';

export interface TestServerOptions<C extends PartContext> {
  create: ApiCreate<C>;
  ctx?: C;
}

export interface TestMcpOptions {
  create: (ctx: McpContext) => unknown;
  ctx?: PartContext;
}

export interface TestServer {
  url: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

export interface TestMcp extends TestServer {
  // A tool by the name it registered, args as given: what it answers in structuredContent.
  call(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

const TEST_BUILD = { commit: '0'.repeat(40), buildTime: '2026-01-01T00:00:00Z' };

const testPackage = (
  ctx: PartContext,
  parts: ExtensionPackage['agentage']['parts']
): ExtensionPackage => ({
  name: `@agentage/extension-${ctx.extension.id}`,
  version: ctx.extension.version,
  engines: { agentage: '^0.3.0' },
  agentage: { id: ctx.extension.id, parts },
});

const startOn = async (app: Express): Promise<TestServer> => {
  const server = await listen(app, 0, '127.0.0.1');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    fetch: (path, init) => fetch(`${url}${path}`, init),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

// Runs an api part's create(ctx) inside the kit's real app on 127.0.0.1, port chosen by the OS.
export const startTestServer = async <C extends PartContext = PartContext>(
  options: TestServerOptions<C>
): Promise<TestServer> => {
  const ctx = options.ctx ?? (createTestContext() as unknown as C);
  const router = await options.create(ctx);
  const pkg = testPackage(ctx, { api: true });
  return startOn(createApiApp({ pkg, build: TEST_BUILD, router, log: ctx.log }));
};

// Runs an mcp part's create(ctx) inside the kit's real /mcp app: tools named {id}__{name}.
export const startTestMcp = async (options: TestMcpOptions): Promise<TestMcp> => {
  const ctx = options.ctx ?? createTestContext();
  const registry = createToolRegistry();
  await options.create({ ...ctx, tool: registry.tool });
  const pkg = testPackage(ctx, { mcp: true });
  const app = createMcpApp({
    pkg,
    build: TEST_BUILD,
    log: ctx.log,
    tools: registry.tools,
    listing: 'open',
  });
  const server = await startOn(app);
  const call = (name: string, args = {}) =>
    callTool(`${server.url}/mcp`, prefixed(ctx.extension.id, name), args);
  return { ...server, call };
};
