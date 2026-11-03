import { type BuildInfo } from '../discovery/discovery.js';
import { type Env } from '../runtime/build-info.js';
import { mustRun, type Run } from './exec.js';

const FULL_SHA = /^[0-9a-f]{40}$/;

const isoSeconds = (date: Date): string => `${date.toISOString().slice(0, 19)}Z`;

const commitOf = async (dir: string, env: Env, run: Run): Promise<string> => {
  const given = env['COMMIT_SHA'] || env['GITHUB_SHA'];
  if (given) return given;
  return (await mustRun(run, 'git', ['rev-parse', 'HEAD'], { cwd: dir })).trim();
};

// The commit every image label, /health and the record carry: CI's sha, else the checkout's HEAD.
export const resolveBuildInfo = async (
  dir: string,
  env: Env,
  run: Run,
  now: Date = new Date()
): Promise<BuildInfo> => {
  const commit = await commitOf(dir, env, run);
  if (!FULL_SHA.test(commit)) throw new Error(`commit is not a full 40-hex sha: ${commit}`);
  return { commit, buildTime: env['BUILD_TIME'] || isoSeconds(now) };
};
