import { type BuildInfo } from '../discovery/discovery.js';

export type Env = Readonly<Record<string, string | undefined>>;

const UNKNOWN_COMMIT = '0'.repeat(40);

const isoSeconds = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

// COMMIT_SHA and BUILD_TIME are baked into every image by the recipe; a bare dev run shows zeros.
export const buildInfoFromEnv = (env: Env, now: Date = new Date()): BuildInfo => ({
  commit:
    env['COMMIT_SHA'] && /^[0-9a-f]{40}$/.test(env['COMMIT_SHA'])
      ? env['COMMIT_SHA']
      : UNKNOWN_COMMIT,
  buildTime: env['BUILD_TIME'] || isoSeconds(now),
});

export const portFromEnv = (env: Env, fallback = 3000): number => {
  const port = Number(env['PORT']);
  return env['PORT'] !== undefined && Number.isInteger(port) && port >= 0 && port < 65536
    ? port
    : fallback;
};
