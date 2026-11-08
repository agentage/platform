import { type BuildInfo } from '../discovery/discovery.js';
import { FULL_SHA } from '../manifest/primitives.schema.js';
import { buildTimeOf, type Env } from '../runtime/build-info.js';
import { mustRun, type Run } from './exec.js';

const headCommit = async (dir: string, env: Env, run: Run): Promise<string> => {
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
  const commit = await headCommit(dir, env, run);
  if (!FULL_SHA.test(commit)) throw new Error(`commit is not a full 40-hex sha: ${commit}`);
  return { commit, buildTime: buildTimeOf(env, now) };
};
