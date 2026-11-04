import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { serverPartRecipe } from './recipe.js';

// Runs the recipe's own HEALTHCHECK command against a server answering `status`.
const healthcheckExit = async (healthcheck: string, status: number): Promise<unknown> => {
  const server = createServer((_req, res) => void res.writeHead(status).end());
  await once(server.listen(0, '127.0.0.1'), 'listening');
  const { port } = server.address() as AddressInfo;
  const [, ...args] = JSON.parse(healthcheck.slice(healthcheck.indexOf('CMD ') + 4)) as string[];
  const local = args.map((arg) => arg.replace('127.0.0.1:3000', `127.0.0.1:${port}`));
  const [code] = await once(spawn(process.execPath, local), 'exit');
  server.close();
  return code;
};

describe('server part recipe', () => {
  const recipe = serverPartRecipe('api');
  const lines = recipe.split('\n');

  it('is multi-stage node:26-alpine with production dependencies only', () => {
    expect(lines.filter((line) => line.startsWith('FROM '))).toEqual([
      'FROM node:26-alpine AS deps',
      'FROM node:26-alpine AS runner',
    ]);
    expect(recipe).toContain('RUN npm ci --omit=dev');
  });

  it('promotes COMMIT_SHA and BUILD_TIME to ENV in the runner stage', () => {
    const runner = recipe.slice(recipe.indexOf('AS runner'));
    expect(runner).toContain('ARG COMMIT_SHA');
    expect(runner).toContain('ARG BUILD_TIME');
    expect(runner).toContain('COMMIT_SHA=$COMMIT_SHA');
    expect(runner).toContain('BUILD_TIME=$BUILD_TIME');
  });

  it('runs as node, probes 127.0.0.1 and starts the kit entry for the part', () => {
    const lastUser = lines.filter((line) => line.startsWith('USER ')).pop();
    expect(lastUser).toBe('USER node');
    const healthcheck = lines.find((line) => line.startsWith('HEALTHCHECK')) ?? '';
    expect(healthcheck).toContain('http://127.0.0.1:3000/health');
    expect(healthcheck).not.toContain('localhost');
    expect(lines).toContain(
      'CMD ["node", "node_modules/@agentage/extension/dist/runtime/main.js", "api"]'
    );
  });

  it.for([
    [200, 0],
    [503, 0],
    [404, 1],
    [500, 1],
  ])(
    'the HEALTHCHECK maps /health %i to exit %i: an outage restarts nothing',
    async ([status, exit]) => {
      const healthcheck = lines.find((line) => line.startsWith('HEALTHCHECK')) ?? '';
      expect(await healthcheckExit(healthcheck, status as number)).toBe(exit);
    }
  );
});
