import { z } from 'zod';
import { plural } from './lines.js';

// The migrate entry's last stdout line (migrate.ts); an image on kit 0.2.0 prints no seedsBefore.
const MigrateSummarySchema = z.object({
  migrations: z.int().min(0),
  applied: z.int().min(0),
  seeds: z.int().min(0),
  seedsBefore: z.int().min(0).default(0),
});

export type MigrateSummary = z.infer<typeof MigrateSummarySchema>;

const lastJson = (out: string): unknown => {
  try {
    return JSON.parse(out.trim().split('\n').at(-1) ?? '');
  } catch {
    return undefined;
  }
};

export const summaryOf = (out: string): MigrateSummary => {
  const parsed = MigrateSummarySchema.safeParse(lastJson(out));
  if (!parsed.success) throw new Error(`the migrate job printed no summary: ${out.slice(-200)}`);
  return parsed.data;
};

const migrationsPhrase = ({ migrations, applied }: MigrateSummary): string => {
  const already = migrations - applied;
  if (already === 0) return `${plural(applied, 'migration')} applied`;
  if (applied === 0) return `${plural(already, 'migration')} already applied`;
  return `${plural(applied, 'migration')} applied, ${already} already applied`;
};

const seedsPhrase = ({ seeds, seedsBefore }: MigrateSummary): string =>
  seeds === 0 && seedsBefore > 0
    ? `${plural(seedsBefore, 'seed')} already applied`
    : plural(seeds, 'seed');

// A kept volume says so: what this run applied, and what an earlier run already had.
export const storePhrase = (summary: MigrateSummary): string =>
  `${migrationsPhrase(summary)} · ${seedsPhrase(summary)}`;
