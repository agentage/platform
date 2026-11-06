import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { messageOf } from '../../log/log.js';
import { hasPostgres } from '../../manifest/parts.js';
import { sqlFiles } from '../../store/migrations.js';
import { type CheckRule, type Finding } from '../check.js';
import { type Run } from '../exec.js';
import { TIMEOUTS } from '../timeouts.js';
import { STORE_IMAGE } from '../up/compose.js';

// A fixed script: the file names are its arguments, already held to NNN-name.sql.
const SCRIPT = [
  'initdb -D /tmp/pg -U postgres -A trust >/dev/null',
  'pg_ctl -D /tmp/pg -w -l /tmp/pg.log start >/dev/null',
  'for f in "$@"; do psql -v ON_ERROR_STOP=1 -1 -q -U postgres -f "/migrations/$f" || exit 1; done',
].join(' && ');

// Attached with --rm and --init: the container goes with this process, Ctrl-C included.
const runArgs = (dir: string, files: string[]) => [
  ...['run', '--rm', '--init', '-e', 'TINI_KILL_PROCESS_GROUP=1'],
  ...['--network', 'none', '--user', 'postgres'],
  ...['-v', `${resolve(dir, 'migrations')}:/migrations:ro`, '--entrypoint', 'sh'],
  ...[STORE_IMAGE, '-c', SCRIPT, 'sh', ...files],
];

const failure = (stderr = ''): Finding => {
  const [, file, line, why] =
    /^psql:\/migrations\/([^:]+):(\d+): (?:ERROR:\s+)?(.*)$/m.exec(stderr) ?? [];
  const problem = `fails on ${STORE_IMAGE}: ${why ? `ERROR: ${why}` : stderr.trim().split('\n').pop()}`;
  return file ? { file: `migrations/${file}`, line: Number(line), problem } : { problem };
};

// The migrate job sends each file through pg as plain SQL, so a psql meta-command would fail there.
const metaCommands = async (dir: string, files: string[]): Promise<Finding[]> => {
  const texts = await Promise.all(files.map((f) => readFile(join(dir, 'migrations', f), 'utf8')));
  return files.flatMap((f, i) => {
    const line = (texts[i] ?? '').split('\n').findIndex((text) => /^\s*\\/.test(text));
    const problem = 'is a psql meta-command: the migrate job sends plain SQL';
    return line < 0 ? [] : [{ file: `migrations/${f}`, line: line + 1, problem }];
  });
};

const dockerAnswers = (run: Run): Promise<boolean> =>
  run('docker', ['version'], { quiet: true }).then(
    ({ code }) => code === 0,
    () => false
  );

const migrationFiles = (dir: string) =>
  sqlFiles(join(dir, 'migrations')).catch((err: unknown) => {
    throw new Error(messageOf(err).replace(join(dir, 'migrations'), 'migrations'));
  });

export const store: CheckRule = {
  name: 'store',
  run: async ({ dir, pkg, run, requireDocker }) => {
    if (!hasPostgres(pkg)) return { skipped: 'no store' };
    const files = await migrationFiles(dir);
    const meta = await metaCommands(dir, files);
    if (files.length === 0 || meta.length > 0) return meta;
    if (!(await dockerAnswers(run)))
      return requireDocker
        ? [{ problem: 'docker does not answer: build needs it' }]
        : { skipped: 'no docker' };
    const result = await run('docker', runArgs(dir, files), {
      quiet: true,
      timeoutMs: TIMEOUTS.start,
    });
    return result.code === 0 ? [] : [failure(result.stderr)];
  },
};
