// Applied before the extension's own files; `kit:` never matches NNN-name.sql, so no name collides.
export const KIT_PREFIX = 'kit:';

// Defensive: a store from before 0.7 already holds the table its worker created lazily.
export const JOB_RUNS_SQL = `create table if not exists agentage_job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  status text not null,
  log text not null,
  timeout_ms integer
);
alter table agentage_job_runs add column if not exists agcid text`;

export const KIT_MIGRATIONS: readonly { name: string; sql: string }[] = [
  { name: `${KIT_PREFIX}001-job-runs`, sql: JOB_RUNS_SQL },
];

// The kit's own tables: a store holding only these still counts as empty and gets the seeds.
export const KIT_TABLES = ['_migrations', 'agentage_job_runs'];
