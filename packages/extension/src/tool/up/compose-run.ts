import { mustRun, type Run } from '../exec.js';

export interface ComposeTarget {
  file?: string;
  project: string;
}

export interface ServiceState {
  service: string;
  state: string;
  health: string;
  exitCode: number;
}

export const composeArgs = (target: ComposeTarget, args: string[]): string[] => [
  'compose',
  ...(target.file ? ['-f', target.file] : []),
  '-p',
  target.project,
  ...args,
];

export const compose = (
  run: Run,
  target: ComposeTarget,
  args: string[],
  timeoutMs?: number
): Promise<string> => mustRun(run, 'docker', composeArgs(target, args), { timeoutMs });

interface PsRow {
  Service?: string;
  State?: string;
  Health?: string;
  ExitCode?: number;
}

// `compose ps --format json` prints one object per line (older releases: one array).
export const parsePs = (stdout: string): ServiceState[] => {
  const text = stdout.trim();
  if (text === '') return [];
  const rows: PsRow[] = text.startsWith('[')
    ? (JSON.parse(text) as PsRow[])
    : text.split('\n').map((line) => JSON.parse(line) as PsRow);
  return rows.map((row) => ({
    service: row.Service ?? '',
    state: row.State ?? '',
    health: row.Health ?? '',
    exitCode: row.ExitCode ?? 0,
  }));
};

export const states = async (run: Run, target: ComposeTarget): Promise<ServiceState[]> =>
  parsePs(await compose(run, target, ['ps', '-a', '--format', 'json']));
