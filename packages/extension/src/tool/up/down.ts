import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readManifest } from '../../manifest/read-manifest.js';
import { quietly, runCommand, type Run } from '../exec.js';
import { projectName } from './compose.js';
import { plural, stepLine } from './lines.js';
import { LOCAL_DIR } from './local-record.js';

export interface DownOptions {
  dir?: string;
  keepData?: boolean;
  onLine?: (line: string) => void;
}

export interface DownResult {
  containers: number;
  networks: number;
  volumes: number;
}

const count = (log: string, kind: string): number =>
  log.split('\n').filter((line) => new RegExp(`\\b${kind}\\b.*\\bRemoved\\b`).test(line)).length;

// Everything `up` started goes; --keep-data keeps the store volume for the next `up`.
export const down = async (
  options: DownOptions = {},
  run: Run = runCommand
): Promise<DownResult> => {
  const dir = resolve(options.dir ?? '.');
  const pkg = await readManifest(dir);
  const file = join(dir, LOCAL_DIR, 'compose.json');
  const withFile = await access(file).then(
    () => ['-f', file],
    () => []
  );
  const args = [
    'compose',
    ...withFile,
    '-p',
    projectName(pkg),
    '--profile',
    'jobs',
    'down',
    '--remove-orphans',
  ];
  const result = await quietly(run)('docker', options.keepData ? args : [...args, '--volumes']);
  if (result.code !== 0)
    throw new Error(`docker compose down failed: ${(result.stderr ?? '').trim()}`);
  const log = result.stderr ?? '';
  const removed = {
    containers: count(log, 'Container'),
    networks: count(log, 'Network'),
    volumes: count(log, 'Volume'),
  };
  const kept = options.keepData ? ' (the store volume kept)' : '';
  const what = `${plural(removed.containers, 'container')} · ${plural(removed.networks, 'network')} · ${plural(removed.volumes, 'volume')}${kept}`;
  options.onLine?.(stepLine('removed', what));
  return removed;
};
