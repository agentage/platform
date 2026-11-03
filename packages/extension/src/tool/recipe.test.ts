import { describe, expect, it } from 'vitest';
import { serverPartRecipe } from './recipe.js';

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
});
