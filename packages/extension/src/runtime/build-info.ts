import { type BuildInfo } from '../discovery/discovery.js';
import { FULL_SHA } from '../manifest/primitives.schema.js';

export type Env = Readonly<Record<string, string | undefined>>;

const UNKNOWN_COMMIT = '0'.repeat(40);

export const isoSeconds = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

const commitOf = (sha = ''): string => (FULL_SHA.test(sha) ? sha : UNKNOWN_COMMIT);

// COMMIT_SHA and BUILD_TIME are baked into every image by the recipe; a bare dev run shows zeros.
export const buildInfoFromEnv = (env: Env, now: Date = new Date()): BuildInfo => ({
  commit: commitOf(env['COMMIT_SHA']),
  buildTime: env['BUILD_TIME'] || isoSeconds(now),
});

export const portFromEnv = (env: Env, fallback = 3000): number => {
  const port = Number(env['PORT']);
  return env['PORT'] !== undefined && Number.isInteger(port) && port >= 0 && port < 65536
    ? port
    : fallback;
};
