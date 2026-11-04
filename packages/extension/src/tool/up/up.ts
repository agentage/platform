import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { checkCli } from '../../command/check-cli.js';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { imageParts, normalizeParts } from '../../manifest/parts.js';
import { readManifest } from '../../manifest/read-manifest.js';
import { type Env } from '../../runtime/build-info.js';
import { build } from '../build.js';
import { quietly, runCommand, type Run } from '../exec.js';
import { compose, type ComposeTarget } from './compose-run.js';
import { composeFile, projectName, STORE_IMAGE } from './compose.js';
import { GATEWAY_PORT, gatewayConfig, ISSUER_PORT } from './gateway.js';
import { plural, stepLine } from './lines.js';
import { assertDiscoverable, LOCAL_DIR, writeLocalRecord } from './local-record.js';
import { waitHealthy } from './wait.js';

export interface UpOptions {
  dir?: string;
  env?: Env;
  onLine?: (line: string) => void;
}

export interface UpDeps {
  run: Run;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export interface UpResult {
  parts: number;
  seconds: number;
}

interface Session {
  dir: string;
  pkg: ExtensionPackage;
  run: Run;
  target: ComposeTarget;
  line: (label: string, what: string, detail?: string) => void;
  deps: UpDeps;
}

const GATEWAY = `http://localhost:${GATEWAY_PORT}`;

const renderFiles = async (s: Session, recordFile: string, tags: Record<string, string>) => {
  const gatewayFile = join(s.dir, LOCAL_DIR, 'gateway.yml');
  await writeFile(
    gatewayFile,
    `${JSON.stringify(gatewayConfig(imageParts(s.pkg), s.pkg.version), null, 2)}\n`
  );
  await writeFile(
    s.target.file ?? '',
    `${JSON.stringify(composeFile({ pkg: s.pkg, tags, recordFile, gatewayFile }), null, 2)}\n`
  );
};

const buildStep = async (s: Session, env: Env) => {
  const built = await build({ dir: s.dir, env }, { run: s.run });
  s.line(
    'build',
    `${plural(built.images.length, 'image')} from the release recipes`,
    'same recipe and tags as a release'
  );
  const { file, record } = await writeLocalRecord(s.dir, s.pkg, built, s.run);
  assertDiscoverable(record, GATEWAY);
  s.line('record', `${LOCAL_DIR}/record.json`, 'discovery valid');
  await renderFiles(
    s,
    file,
    Object.fromEntries(built.images.map((image) => [image.part, image.tag]))
  );
};

// The migrate job runs before any part starts; its last stdout line is the summary.
const storeStep = async (s: Session) => {
  await compose(s.run, s.target, ['up', '-d', 'store']);
  await waitHealthy(s.target, ['store'], s.deps);
  const out = await compose(s.run, s.target, ['run', '--rm', '--no-deps', 'migrate']);
  const summary = JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as {
    applied?: number;
    seeds?: number;
  };
  s.line(
    'store',
    STORE_IMAGE,
    `${plural(summary.applied ?? 0, 'migration')} applied · ${plural(summary.seeds ?? 0, 'seed')}`
  );
};

const ROUTES = { pages: '/', ui: '/ui/{version}/', api: '/api/v1/', mcp: '/mcp' } as const;

export const routesOf = (pkg: ExtensionPackage): string[] =>
  (Object.keys(ROUTES) as (keyof typeof ROUTES)[])
    .filter((part) => imageParts(pkg).includes(part))
    .map((part) => ROUTES[part].replace('{version}', pkg.version));

const partsStep = async (s: Session) => {
  await compose(s.run, s.target, ['up', '-d', '--remove-orphans']);
  const services = [...imageParts(s.pkg), 'gateway', 'issuer'];
  await waitHealthy(s.target, services, s.deps);
  s.line('issuer', 'dev tokens', `http://localhost:${ISSUER_PORT}`);
  s.line('gateway', GATEWAY, routesOf(s.pkg).join(' · '));
};

const cliStep = async (s: Session): Promise<number> => {
  if (!normalizeParts(s.pkg.agentage.parts).code.cli) return 0;
  const problem = await checkCli(s.dir);
  if (problem) throw new Error(`cli part: ${problem}`);
  return 1;
};

// The laptop shape of a deployment: the release images, a local record, store, issuer, gateway.
export const up = async (
  options: UpOptions = {},
  deps: UpDeps = { run: runCommand }
): Promise<UpResult> => {
  const started = Date.now();
  const dir = resolve(options.dir ?? '.');
  const pkg = await readManifest(dir);
  const target = { file: join(dir, LOCAL_DIR, 'compose.json'), project: projectName(pkg) };
  const line = (label: string, what: string, detail?: string) =>
    options.onLine?.(stepLine(label, what, detail));
  const s: Session = {
    dir,
    pkg,
    run: quietly(deps.run),
    target,
    line,
    deps: { ...deps, run: quietly(deps.run) },
  };
  await buildStep(s, options.env ?? process.env);
  const store = normalizeParts(pkg.agentage.parts).store === 'postgres';
  if (store) await storeStep(s);
  await partsStep(s);
  const parts = imageParts(pkg).length + (store ? 1 : 0) + (await cliStep(s));
  const seconds = Math.round((Date.now() - started) / 1000);
  line('ready', `${plural(parts, 'part')} healthy`, `${seconds} s`);
  return { parts, seconds };
};
