import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { checkCli } from '../../command/check-cli.js';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { hasPostgres, imageParts, normalizeParts } from '../../manifest/parts.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Env } from '../../runtime/build-info.js';
import { build } from '../build.js';
import { quietly, runCommand } from '../exec.js';
import { compose, type ComposeTarget } from './compose-run.js';
import { composeFile, projectName, STORE_IMAGE } from './compose.js';
import { GATEWAY_PORT, gatewayConfig, ISSUER_PORT, PART_PATHS, partPath } from './gateway.js';
import { plural, stepLine } from './lines.js';
import { assertDiscoverable, LOCAL_DIR, writeLocalRecord } from './local-record.js';
import { waitHealthy, type WaitDeps } from './wait.js';

export interface UpOptions {
  dir?: string;
  env?: Env;
  onLine?: (line: string) => void;
}

export type UpDeps = WaitDeps;

export interface UpResult {
  parts: number;
  seconds: number;
}

interface Session {
  dir: string;
  pkg: ExtensionPackage;
  target: ComposeTarget;
  line: (label: string, what: string, detail?: string) => void;
  deps: UpDeps;
}

const GATEWAY = `http://localhost:${GATEWAY_PORT}`;

// The migrate entry's last stdout line (migrate.ts).
const MigrateSummarySchema = z.object({
  migrations: z.int().min(0),
  applied: z.int().min(0),
  seeds: z.int().min(0),
});

const lastJson = (out: string): unknown => {
  try {
    return JSON.parse(out.trim().split('\n').at(-1) ?? '');
  } catch {
    return undefined;
  }
};

const summaryOf = (out: string) => {
  const parsed = MigrateSummarySchema.safeParse(lastJson(out));
  if (!parsed.success) throw new Error(`the migrate job printed no summary: ${out.slice(-200)}`);
  return parsed.data;
};

const jsonFile = (file: string, value: unknown) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

const renderFiles = async (s: Session, recordFile: string, tags: Record<string, string>) => {
  const gatewayFile = join(s.dir, LOCAL_DIR, 'gateway.yml');
  await jsonFile(gatewayFile, gatewayConfig(imageParts(s.pkg), s.pkg.version));
  await jsonFile(s.target.file ?? '', composeFile({ pkg: s.pkg, tags, recordFile, gatewayFile }));
};

const buildStep = async (s: Session, env: Env) => {
  const built = await build({ dir: s.dir, env }, { run: s.deps.run });
  const images = plural(built.images.length, 'image');
  s.line('build', `${images} from the release recipes`, 'same recipe and tags as a release');
  const { file, record } = await writeLocalRecord(s.dir, s.pkg, built, s.deps.run);
  assertDiscoverable(record, GATEWAY);
  s.line('record', `${LOCAL_DIR}/record.json`, 'discovery valid');
  await renderFiles(s, file, Object.fromEntries(built.images.map((i) => [i.part, i.tag])));
};

// The migrate job runs before any part starts.
const storeStep = async (s: Session) => {
  await compose(s.deps.run, s.target, ['up', '-d', 'store']);
  await waitHealthy(s.target, ['store'], s.deps);
  const out = await compose(s.deps.run, s.target, ['run', '--rm', '--no-deps', 'migrate']);
  const summary = summaryOf(out);
  const what = `${plural(summary.applied, 'migration')} applied · ${plural(summary.seeds, 'seed')}`;
  s.line('store', STORE_IMAGE, what);
};

export const routesOf = (pkg: ExtensionPackage): string[] =>
  (Object.keys(PART_PATHS) as (keyof typeof PART_PATHS)[])
    .filter((part) => imageParts(pkg).includes(part))
    .map((part) => partPath(part, pkg.version));

const partsStep = async (s: Session) => {
  await compose(s.deps.run, s.target, ['up', '-d', '--remove-orphans']);
  await waitHealthy(s.target, [...imageParts(s.pkg), 'gateway', 'issuer'], s.deps);
  s.line('issuer', 'dev tokens', `http://localhost:${ISSUER_PORT}`);
  s.line('gateway', GATEWAY, routesOf(s.pkg).join(' · '));
};

const cliStep = async (s: Session): Promise<number> => {
  if (!normalizeParts(s.pkg.agentage.parts).code.cli) return 0;
  const problem = await checkCli(s.dir);
  if (problem) throw new Error(`cli part: ${problem}`);
  return 1;
};

const sessionOf = async (options: UpOptions, deps: UpDeps): Promise<Session> => {
  const dir = resolve(options.dir ?? '.');
  const pkg = await readManifest(dir);
  const target = { file: join(dir, LOCAL_DIR, 'compose.json'), project: projectName(pkg) };
  const line = (label: string, what: string, detail?: string) =>
    options.onLine?.(stepLine(label, what, detail));
  return { dir, pkg, target, line, deps: { ...deps, run: quietly(deps.run) } };
};

// The laptop shape of a deployment: the release images, a local record, store, issuer, gateway.
export const up = async (
  options: UpOptions = {},
  deps: UpDeps = { run: runCommand }
): Promise<UpResult> => {
  const started = Date.now();
  const s = await sessionOf(options, deps);
  await buildStep(s, options.env ?? process.env);
  if (hasPostgres(s.pkg)) await storeStep(s);
  await partsStep(s);
  const parts = imageParts(s.pkg).length + (hasPostgres(s.pkg) ? 1 : 0) + (await cliStep(s));
  const seconds = Math.round((Date.now() - started) / 1000);
  s.line('ready', `${plural(parts, 'part')} healthy`, `${seconds} s`);
  return { parts, seconds };
};
