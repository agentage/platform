import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { migratesStore, storeOf } from '../../manifest/parts.js';
import { SERVED_KINDS } from '../../manifest/primitives.schema.js';
import { sqlFiles } from '../../store/migrations.js';
import { type CheckRule, type Finding } from '../check.js';
import { type Run } from '../exec.js';
import { TIMEOUTS } from '../timeouts.js';
import { STORE_IMAGE } from '../up/compose.js';

const PSQL = 'psql -v ON_ERROR_STOP=1 -1 -q -U postgres -f "/tmp/m/$f" || exit 1';
const AS_POSTGRES = `initdb -D /tmp/pg -U postgres -A trust >/dev/null && pg_ctl -D /tmp/pg -w -l /tmp/pg.log start >/dev/null && for f in "$@"; do ${PSQL}; done`;
// Root copies the files where postgres can read them (a 0600 checkout); the names, held to NNN-name.sql, are its arguments.
const SCRIPT = `cp -r /migrations /tmp/m && chmod -R a+rX /tmp/m && exec su postgres -s /bin/sh -c '${AS_POSTGRES}' sh "$@"`;

// Attached with --rm and --init: the container goes with this process, Ctrl-C included.
const runArgs = (dir: string, files: string[]) => [
  ...['run', '--rm', '--init', '-e', 'TINI_KILL_PROCESS_GROUP=1', '--network', 'none'],
  ...['-v', `${resolve(dir, 'migrations')}:/migrations:ro`, '--entrypoint', 'sh'],
  ...[STORE_IMAGE, '-c', SCRIPT, 'sh', ...files],
];

const failure = (stderr = ''): Finding => {
  const daemon = /^docker: (.*)$/m.exec(stderr)?.[1];
  if (daemon) return { problem: `${STORE_IMAGE} does not run: ${daemon}` };
  const [, file, line, why] =
    /^psql:\/tmp\/m\/([^:]+):(\d+): (?:ERROR:\s+)?(.*)$/m.exec(stderr) ?? [];
  const problem = `fails on ${STORE_IMAGE}: ${why ? `ERROR: ${why}` : stderr.trim().split('\n').pop()}`;
  return file ? { file: `migrations/${file}`, line: Number(line), problem } : { problem };
};

// Quoted text, dollar-quoted bodies and comments, blanked to their newlines before looking for a backslash.
const SQL_TEXT = /'(?:[^']|'')*'|"(?:[^"]|"")*"|\$(\w*)\$[\s\S]*?\$\1\$|--[^\n]*|\/\*[\s\S]*?\*\//g;

// The migrate job sends each file through pg as plain SQL, so a psql meta-command would fail there.
const metaCommands = async (dir: string, files: string[]): Promise<Finding[]> => {
  const texts = await Promise.all(files.map((f) => readFile(join(dir, 'migrations', f), 'utf8')));
  return files.flatMap((f, i) => {
    const code = (texts[i] ?? '').replace(SQL_TEXT, (t) => t.replace(/[^\n]/g, ''));
    const at = code.indexOf('\\');
    const problem = 'has a psql meta-command: the migrate job sends plain SQL';
    const line = code.slice(0, at).split('\n').length;
    return at < 0 ? [] : [{ file: `migrations/${f}`, line, problem }];
  });
};

const dockerAnswers = (run: Run): Promise<boolean> =>
  run('docker', ['version'], { quiet: true }).then(
    ({ code }) => code === 0,
    () => false
  );

export const store: CheckRule = {
  name: 'store',
  run: async ({ dir, pkg, run, requireDocker }) => {
    const kind = storeOf(pkg);
    if (!kind) return { skipped: 'no store' };
    if (!SERVED_KINDS.includes(kind))
      return [{ problem: `kind ${kind} is not served yet; served: ${SERVED_KINDS.join(', ')}` }];
    if (!migratesStore(pkg)) return { skipped: `kind ${kind} has no migrations` };
    const files = await sqlFiles(join(dir, 'migrations'));
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
