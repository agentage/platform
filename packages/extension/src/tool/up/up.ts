import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { hasStore, imageParts, normalizeParts } from '../../manifest/parts.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Env } from '../../runtime/build-info.js';
import { build } from '../build.js';
import { quietly, runCommand } from '../exec.js';
import { exists } from '../stage.js';
import { TIMEOUTS } from '../timeouts.js';
import { compose, type ComposeTarget } from './compose-run.js';
import { composeFile, STORE_IMAGE } from './compose.js';
import { GATEWAY_PORT, gatewayConfig, ISSUER_PORT, PART_PATHS, partPath } from './gateway.js';
import { plural, stepLine } from './lines.js';
import { assertDiscoverable, LOCAL_DIR, writeLocalRecord } from './local-record.js';
import { assertPortsFree } from './ports.js';
import { writeUpSecrets } from './secrets.js';
import { projectName, workingCopy } from './project.js';
import { storePhrase, summaryOf } from './store-line.js';
import { assertHealthBodies } from './health.js';
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
  project: string;
}

interface Session {
  dir: string;
  pkg: ExtensionPackage;
  target: ComposeTarget & { file: string };
  line: (label: string, what: string, detail?: string) => void;
  deps: UpDeps;
  secretFiles: Record<string, string> | undefined;
}

const GATEWAY = `http://localhost:${GATEWAY_PORT}`;

const jsonFile = (file: string, value: unknown) =>
  writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

const renderFiles = async (s: Session, recordFile: string, tags: Record<string, string>) => {
  const gatewayFile = join(s.dir, LOCAL_DIR, 'gateway.yml');
  const seeds = join(s.dir, 'seeds');
  const seedsDir = (await exists(seeds)) ? seeds : undefined;
  await jsonFile(gatewayFile, gatewayConfig(imageParts(s.pkg), s.pkg.version));
  const { pkg, secretFiles, target } = s;
  const project = target.project;
  await jsonFile(
    target.file,
    composeFile({ pkg, project, tags, recordFile, gatewayFile, seedsDir, secretFiles })
  );
};

const buildStep = async (s: Session, env: Env) => {
  const built = await build({ dir: s.dir, env }, { run: s.deps.run });
  const images = plural(built.images.length, 'image');
  s.line('build', `${images} from the release recipes`, 'same recipe and tags as a release');
  const { file, record } = await writeLocalRecord(s.dir, s.pkg, built, s.deps.run);
  assertDiscoverable(record, GATEWAY);
  s.line('record', `${LOCAL_DIR}/record.json`, 'discovery valid');
  await renderFiles(s, file, Object.fromEntries(built.images.map((i) => [i.part, i.tag])));
  return built.commit;
};

// The migrate job runs before any part starts; a kept volume reports what it already had.
const storeStep = async (s: Session) => {
  await compose(s.deps.run, s.target, ['up', '-d', 'store'], TIMEOUTS.start);
  await waitHealthy(s.target, ['store'], s.deps);
  const run = ['run', '--rm', '--no-deps', 'migrate'];
  const out = await compose(s.deps.run, s.target, run, TIMEOUTS.migrate).catch((err: Error) => {
    throw new Error(`the migrate job failed, no part was started: ${err.message}`);
  });
  const summary = summaryOf(out);
  s.line('store', STORE_IMAGE, storePhrase(summary));
};

export const routesOf = (pkg: ExtensionPackage): string[] =>
  (Object.keys(PART_PATHS) as (keyof typeof PART_PATHS)[])
    .filter((part) => imageParts(pkg).includes(part))
    .map((part) => partPath(part, pkg.version));

const partsStep = async (s: Session, commit: string) => {
  await compose(s.deps.run, s.target, ['up', '-d', '--remove-orphans'], TIMEOUTS.start);
  await waitHealthy(s.target, [...imageParts(s.pkg), 'gateway', 'issuer'], s.deps);
  await assertHealthBodies(s.deps.run, s.target, imageParts(s.pkg), commit);
  s.line('issuer', 'dev tokens', `http://localhost:${ISSUER_PORT}`);
  s.line('gateway', GATEWAY, routesOf(s.pkg).join(' · '));
};

// The cli part has no container: build's check already proved its handlers match the commands.
const cliParts = (pkg: ExtensionPackage): number =>
  normalizeParts(pkg.agentage.parts).code.cli ? 1 : 0;

const sessionOf = async (options: UpOptions, deps: UpDeps): Promise<Session> => {
  const dir = await workingCopy(options.dir);
  const pkg = await readManifest(dir);
  const file = join(dir, LOCAL_DIR, 'compose.json');
  const target = { file, project: projectName(pkg.agentage.id, dir) };
  const line = (label: string, what: string, detail?: string) =>
    options.onLine?.(stepLine(label, what, detail));
  const secretFiles = await writeUpSecrets(dir, pkg, options.env ?? process.env);
  return { dir, pkg, target, line, deps: { ...deps, run: quietly(deps.run) }, secretFiles };
};

// The laptop shape of a deployment: the release images, a local record, store, issuer, gateway.
export const up = async (
  options: UpOptions = {},
  deps: UpDeps = { run: runCommand }
): Promise<UpResult> => {
  const started = Date.now();
  const s = await sessionOf(options, deps);
  await assertPortsFree(s.deps.run, s.target.project);
  const commit = await buildStep(s, options.env ?? process.env);
  // Again after the build: another up may have started meanwhile, and the store comes next.
  await assertPortsFree(s.deps.run, s.target.project);
  if (hasStore(s.pkg, 'postgres')) await storeStep(s);
  await partsStep(s, commit);
  const parts = imageParts(s.pkg).length + (hasStore(s.pkg, 'postgres') ? 1 : 0) + cliParts(s.pkg);
  const seconds = Math.round((Date.now() - started) / 1000);
  s.line('ready', `${plural(parts, 'part')} healthy`, `${seconds} s`);
  return { parts, seconds, project: s.target.project };
};
