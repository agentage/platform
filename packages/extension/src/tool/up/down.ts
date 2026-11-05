import { join, resolve } from 'node:path';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { quietly, runCommand, type Run } from '../exec.js';
import { exists } from '../stage.js';
import { composeArgs, type ComposeTarget } from './compose-run.js';
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

const removedOf = (log: string): DownResult => ({
  containers: count(log, 'Container'),
  networks: count(log, 'Network'),
  volumes: count(log, 'Volume'),
});

const summary = (removed: DownResult, keepData?: boolean): string =>
  [
    plural(removed.containers, 'container'),
    plural(removed.networks, 'network'),
    plural(removed.volumes, 'volume'),
  ].join(' · ') + (keepData ? ' (the store volume kept)' : '');

// The rendered compose file when `up` left one, else the project name alone.
const targetOf = async (dir: string, pkg: ExtensionPackage): Promise<ComposeTarget> => {
  const file = join(dir, LOCAL_DIR, 'compose.json');
  return { file: (await exists(file)) ? file : undefined, project: projectName(pkg) };
};

// Everything `up` started goes; --keep-data keeps the store volume for the next `up`.
export const down = async (
  options: DownOptions = {},
  run: Run = runCommand
): Promise<DownResult> => {
  const dir = resolve(options.dir ?? '.');
  const target = await targetOf(dir, await readManifest(dir));
  const volumes = options.keepData ? [] : ['--volumes'];
  const args = composeArgs(target, ['--profile', 'jobs', 'down', '--remove-orphans', ...volumes]);
  const result = await quietly(run)('docker', args);
  const log = result.stderr ?? '';
  if (result.code !== 0) throw new Error(`docker compose down failed: ${log.trim()}`);
  const removed = removedOf(log);
  options.onLine?.(stepLine('removed', summary(removed, options.keepData)));
  return removed;
};
