import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { hasPostgres } from '../../manifest/parts.js';
import { sqlFiles } from '../../store/migrations.js';
import { type CheckRule, type Finding } from '../check.js';
import { mustRun, type Run } from '../exec.js';
import { TIMEOUTS } from '../timeouts.js';
import { STORE_IMAGE } from '../up/compose.js';

// No network at all, so trust on its own loopback reaches nothing but psql inside it.
const START = ['run', '-d', '--network', 'none', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust'];
const PSQL = ['psql', '-v', 'ON_ERROR_STOP=1', '-1', '-q', '-h', '127.0.0.1', '-U', 'postgres'];

// pg_isready over TCP: the image's init server listens on its socket only, so this waits it out.
const waitReady = async (run: Run, name: string): Promise<void> => {
  const ready = ['exec', name, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'postgres'];
  for (let tries = 0; tries < 60; tries += 1) {
    if ((await run('docker', ready, { quiet: true })).code === 0) return;
    await sleep(500);
  }
  throw new Error(`${STORE_IMAGE} was not ready in 30 s`);
};

// psql names the failing line as psql:<file>:<line>: ERROR: ...
const failure = (file: string, stderr = ''): Finding => {
  const [, line, why] = /^psql:[^:]*:(\d+): (.*)$/m.exec(stderr) ?? [];
  const problem = `fails on ${STORE_IMAGE}: ${why ?? stderr.trim()}`;
  return line ? { file, line: Number(line), problem } : { file, problem };
};

// In the kit's file order, one transaction each, as the migrate job runs them; the first failure ends it.
const applyAll = async (run: Run, name: string, dir: string, files: string[]) => {
  await mustRun(run, 'docker', ['cp', join(dir, 'migrations'), `${name}:/migrations`]);
  for (const file of files) {
    const args = ['exec', name, ...PSQL, '-f', `/migrations/${file}`];
    const result = await run('docker', args, { quiet: true, timeoutMs: TIMEOUTS.migrate });
    if (result.code !== 0) return [failure(`migrations/${file}`, result.stderr)];
  }
  return [];
};

// A throwaway postgres of the platform major, removed whatever happened.
const onFreshStore = async (run: Run, use: (name: string) => Promise<Finding[]>) => {
  const name = `agentage-check-${randomBytes(4).toString('hex')}`;
  try {
    const start = [...START, '--name', name, STORE_IMAGE];
    await mustRun(run, 'docker', start, { quiet: true, timeoutMs: TIMEOUTS.start });
    await waitReady(run, name);
    return await use(name);
  } finally {
    await run('docker', ['rm', '-f', name], { quiet: true }).catch(() => undefined);
  }
};

const dockerAnswers = (run: Run): Promise<boolean> =>
  run('docker', ['version'], { quiet: true }).then(
    ({ code }) => code === 0,
    () => false
  );

export const store: CheckRule = {
  name: 'store',
  run: async ({ dir, pkg, run, requireDocker }) => {
    if (!hasPostgres(pkg)) return { skipped: 'no store' };
    const files = await sqlFiles(join(dir, 'migrations'));
    if (files.length === 0) return [];
    if (await dockerAnswers(run))
      return onFreshStore(run, (name) => applyAll(run, name, dir, files));
    return requireDocker
      ? [{ problem: 'docker does not answer: build needs it' }]
      : { skipped: 'no docker' };
  },
};
