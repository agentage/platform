import { type AddressInfo } from 'node:net';
import { createTestContext, type PartContext } from '../context/context.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { createApiApp } from '../server/app.js';
import { type ApiCreate } from '../server/part.types.js';
import { listen } from '../server/serve.js';

export interface TestServerOptions<C extends PartContext> {
  create: ApiCreate<C>;
  ctx?: C;
}

export interface TestServer {
  url: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  close(): Promise<void>;
}

const TEST_BUILD = { commit: '0'.repeat(40), buildTime: '2026-01-01T00:00:00Z' };

const testPackage = (ctx: PartContext): ExtensionPackage => ({
  name: `@agentage/extension-${ctx.extension.id}`,
  version: ctx.extension.version,
  engines: { agentage: '^0.1.0' },
  agentage: { id: ctx.extension.id, parts: { api: true } },
});

// Runs an api part's create(ctx) inside the kit's real app on 127.0.0.1, port chosen by the OS.
export const startTestServer = async <C extends PartContext = PartContext>(
  options: TestServerOptions<C>
): Promise<TestServer> => {
  const ctx = options.ctx ?? (createTestContext() as unknown as C);
  const router = await options.create(ctx);
  const app = createApiApp({ pkg: testPackage(ctx), build: TEST_BUILD, router, log: ctx.log });
  const server = await listen(app, 0, '127.0.0.1');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    fetch: (path, init) => fetch(`${url}${path}`, init),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};
