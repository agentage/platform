import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const base = process.argv[2] ?? 'origin/master';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const versionAt = (ref, dir) => {
  try {
    return JSON.parse(git('show', `${ref}:${dir}/package.json`)).version;
  } catch {
    return null;
  }
};

const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean);
const failures = [];
for (const name of readdirSync('packages')) {
  const dir = `packages/${name}`;
  const was = versionAt(base, dir);
  if (was === null || was === versionAt('HEAD', dir)) continue;
  const others = changed.filter((f) => f.startsWith(`${dir}/`) && f !== `${dir}/package.json`);
  if (others.length === 0) failures.push(dir);
}
for (const dir of failures)
  console.error(`::error::${dir} changes version with no other change in it`);
process.exit(failures.length === 0 ? 0 : 1);
