import { JOB_RUNS_SQL } from '../store/kit-migrations.js';
import { type Store } from '../store/store.types.js';

export type RunStatus = 'ok' | 'failed';

export interface JobRun {
  job: string;
  startedAt: Date;
  endedAt: Date;
  status: RunStatus;
  log: string;
  timeoutMs?: number;
}

export interface RunStore {
  save(run: JobRun): Promise<void>;
  last(job: string): Promise<JobRun | undefined>;
}

export const KEEP_RUNS = 50;

const INSERT = `insert into agentage_job_runs (job, started_at, ended_at, status, log, timeout_ms)
  values ($1, $2, $3, $4, $5, $6)`;

const PRUNE = `delete from agentage_job_runs where job = $1 and id not in
  (select id from agentage_job_runs where job = $1 order by id desc limit ${KEEP_RUNS})`;

interface RunRow {
  job: string;
  started_at: Date | string;
  ended_at: Date | string;
  status: RunStatus;
  log: string;
  timeout_ms: number | null;
}

const fromRow = (row: RunRow): JobRun => ({
  job: row.job,
  startedAt: new Date(row.started_at),
  endedAt: new Date(row.ended_at),
  status: row.status,
  log: row.log,
  ...(row.timeout_ms === null ? {} : { timeoutMs: row.timeout_ms }),
});

const LAST = 'select * from agentage_job_runs where job = $1 order by id desc limit 1';

const valuesOf = (run: JobRun): unknown[] => [
  run.job,
  run.startedAt,
  run.endedAt,
  run.status,
  run.log,
  run.timeoutMs ?? null,
];

// Runs live in the extension's own store, in a table the kit owns; the last 50 per job are kept.
export const storeRuns = (store: Store): RunStore => {
  let table: Promise<unknown> | undefined;
  // Also here: a worker-only extension has no migrate job (only the api image runs it).
  const ready = () => (table ??= store.query(JOB_RUNS_SQL));
  return {
    save: async (run) => {
      await ready();
      await store.query(INSERT, valuesOf(run));
      await store.query(PRUNE, [run.job]);
    },
    last: async (job) => {
      await ready();
      const { rows } = await store.query<RunRow & Record<string, unknown>>(LAST, [job]);
      return rows[0] ? fromRow(rows[0]) : undefined;
    },
  };
};

// Without a store the runs live in memory, same rule.
export const memoryRuns = (): RunStore & { all(job: string): JobRun[] } => {
  const runs = new Map<string, JobRun[]>();
  const all = (job: string): JobRun[] => runs.get(job) ?? [];
  return {
    save: async (run) => void runs.set(run.job, [...all(run.job), run].slice(-KEEP_RUNS)),
    last: async (job) => all(job).at(-1),
    all,
  };
};
