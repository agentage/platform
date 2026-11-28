import { type z } from 'zod';
import {
  type CloudInstallation,
  CloudInstallationSchema,
  type CloudRow,
} from './cloud-installation.js';

// The rules of C2 one file can break alone (app host repo scripts/lib/installation.mjs, ported).
interface Refusal {
  path: string;
  message: string;
}

// The router is a service of every stack, and the daemon keeps the id host for itself.
const RESERVED = new Set(['router', 'host']);

// The shell is a library of the host, named by the shell key only; never an extension row.
const isShell = (id: string, doc: CloudInstallation) =>
  /^shell(-|$)/.test(id) || id === doc.shell?.package.split('/').pop();

const rowRefusals = (doc: CloudInstallation, seen: Set<string>) => (row: CloudRow, i: number) => {
  const at = `extensions[${i}].id`;
  const out: Refusal[] = [];
  const add = (fails: boolean, message: string) => fails && out.push({ path: at, message });
  add(seen.has(row.id), `${row.id} is listed twice`);
  add(RESERVED.has(row.id), `${row.id} is reserved`);
  // The pages service of a row is named {id}-pages (D81), so no row id may end that way.
  add(row.id.endsWith('-pages'), `${row.id} ends in -pages, the name of a pages service`);
  add(isShell(row.id, doc), `${row.id} is a shell package; name it in the shell key`);
  seen.add(row.id);
  return out;
};

const pagesRefusals = (doc: CloudInstallation): Refusal[] =>
  doc.extensions
    .flatMap((row, i) => (row.expose?.pages === 'public' ? [i] : []))
    .slice(1)
    .map((i) => ({
      path: `extensions[${i}].expose.pages`,
      message: 'a second row serves pages (one per app host)',
    }));

const pathOf = (path: PropertyKey[]) =>
  path
    .map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`))
    .join('')
    .slice(1) || '(file)';

const issuesOf = (error: z.ZodError): Refusal[] =>
  error.issues.map((i) => ({ path: pathOf(i.path), message: i.message }));

// folder: the name of the host's folder (--check); the start has none, its mount is fixed.
const fileRefusals = (doc: CloudInstallation, folder?: string): Refusal[] => {
  const host =
    folder !== undefined && doc.host !== folder
      ? [{ path: 'host', message: `${doc.host} is not the folder name ${folder}` }]
      : [];
  const seen = new Set<string>();
  return [...host, ...doc.extensions.flatMap(rowRefusals(doc, seen)), ...pagesRefusals(doc)];
};

export interface CheckedInstallation {
  installation?: CloudInstallation;
  refusals: string[];
}

// Each refusal as one line `installation.json <path>: <message>`; the installation once it parses.
export const checkInstallation = (value: unknown, folder?: string): CheckedInstallation => {
  const parsed = CloudInstallationSchema.safeParse(value);
  const found = parsed.success ? fileRefusals(parsed.data, folder) : issuesOf(parsed.error);
  const refusals = found.map((r) => `installation.json ${r.path}: ${r.message}`);
  return parsed.success ? { installation: parsed.data, refusals } : { refusals };
};
