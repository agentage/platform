import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readManifest } from '../../manifest/read-manifest.js';
import { quietly, runCommand, type Run } from '../exec.js';
import { composeArgs, type ComposeTarget } from './compose-run.js';
import { plural, stepLine } from './lines.js';
import { LOCAL_DIR } from './local-record.js';
import { legacyProject, projectName, renderedProject, workingCopy } from './project.js';

export interface DownOptions {
  dir?: string;
  keepData?: boolean;
  onLine?: (line: string) => void;
}

export interface DownResult {
  project: string;
  containers: number;
  networks: number;
  volumes: number;
}

type Removed = Omit<DownResult, 'project'>;

const count = (log: string, kind: string): number =>
  log.split('\n').filter((line) => new RegExp(`\\b${kind}\\b.*\\bRemoved\\b`).test(line)).length;

const removedOf = (log: string): Removed => ({
  containers: count(log, 'Container'),
  networks: count(log, 'Network'),
  volumes: count(log, 'Volume'),
});

const summary = (removed: Removed, keepData?: boolean): string => {
  if (removed.containers + removed.networks + removed.volumes === 0) return 'nothing was running';
  const counts = [
    plural(removed.containers, 'container'),
    plural(removed.networks, 'network'),
    plural(removed.volumes, 'volume'),
  ];
  return counts.join(' · ') + (keepData ? ' (the store volume kept)' : '');
};

// This folder's own project; a copied compose.json naming another copy's project is ignored.
const targetOf = async (dir: string): Promise<ComposeTarget> => {
  const { id } = (await readManifest(dir)).agentage;
  const file = join(dir, LOCAL_DIR, 'compose.json');
  const rendered = await renderedProject(file);
  const project = projectName(id, dir);
  if (rendered === project) return { file, project };
  return { project: rendered === legacyProject(id) ? rendered : project };
};

// Everything `up` started in this working copy goes, and only that; --keep-data keeps the store.
export const down = async (
  options: DownOptions = {},
  run: Run = runCommand
): Promise<DownResult> => {
  const dir = await workingCopy(options.dir);
  const target = await targetOf(dir);
  const volumes = options.keepData ? [] : ['--volumes'];
  const args = composeArgs(target, ['--profile', 'jobs', 'down', '--remove-orphans', ...volumes]);
  const result = await quietly(run)('docker', args);
  const log = result.stderr ?? '';
  if (result.code !== 0) throw new Error(`docker compose down failed: ${log.trim()}`);
  await rm(join(dir, LOCAL_DIR, 'secrets'), { recursive: true, force: true });
  const removed = removedOf(log);
  options.onLine?.(stepLine('removed', summary(removed, options.keepData), target.project));
  return { project: target.project, ...removed };
};
