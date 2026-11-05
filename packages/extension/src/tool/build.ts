import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { recordOf, validateRecord, type BuildInfo } from '../discovery/discovery.js';
import { type ExtensionRecord } from '../discovery/discovery.schema.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { imageParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { readManifest } from '../manifest/read-manifest.js';
import { type Env } from '../runtime/build-info.js';
import { resolveBuildInfo } from './build-info.js';
import { assertConforms } from './check.js';
import { createDocker, type Docker } from './docker.js';
import { mustRun, runCommand, type Run } from './exec.js';
import { labelsOf } from './labels.js';
import { recordExtras } from './record-extras.js';
import { RECORD_FILE, stageContext } from './stage.js';
import { TIMEOUTS } from './timeouts.js';

export const DEFAULT_REGISTRY = 'ghcr.io/agentage';

export interface BuildOptions {
  dir?: string;
  push?: boolean;
  registry?: string;
  env?: Env;
}

export interface BuildDeps {
  run: Run;
  docker?: Docker;
  tmpRoot?: string;
}

export interface BuiltImage {
  part: ImagePartKind;
  tag: string;
  digest?: string;
  image?: string;
}

export interface BuildResult {
  id: string;
  version: string;
  commit: string;
  buildTime: string;
  images: BuiltImage[];
  recordFile?: string;
}

interface PartJob {
  dir: string;
  pkg: ExtensionPackage;
  part: ImagePartKind;
  info: BuildInfo;
  tag: string;
}

export const imageTag = (registry: string, pkg: ExtensionPackage, part: ImagePartKind): string =>
  `${registry}/${pkg.agentage.id}-${part}:${pkg.version}`;

const compile = async (dir: string, pkg: ExtensionPackage, run: Run): Promise<void> => {
  const scripts = (pkg as { scripts?: Record<string, unknown> }).scripts;
  if (typeof scripts?.['build'] === 'string')
    await mustRun(run, 'npm', ['run', 'build'], { cwd: dir, timeoutMs: TIMEOUTS.compile });
};

const buildImage = async (job: PartJob, docker: Docker, tmpRoot?: string): Promise<void> => {
  const context = await stageContext(job.dir, job.pkg, job.part, tmpRoot);
  try {
    const buildArgs = {
      COMMIT_SHA: job.info.commit,
      BUILD_TIME: job.info.buildTime,
      IMAGE: job.tag,
    };
    const labels = labelsOf(job.pkg, job.part, job.info);
    await docker.build({ context, tag: job.tag, buildArgs, labels });
  } finally {
    await rm(context, { recursive: true, force: true });
  }
};

const pushImage = async (job: PartJob, docker: Docker): Promise<BuiltImage> => {
  const digest = await docker.push(job.tag);
  const repository = job.tag.slice(0, job.tag.lastIndexOf(':'));
  return { part: job.part, tag: job.tag, digest, image: `${repository}@${digest}` };
};

// The record from the code and the images by digest; `up` writes the same shape from local digests.
export const recordFor = async (
  dir: string,
  pkg: ExtensionPackage,
  info: BuildInfo,
  images: BuiltImage[]
): Promise<ExtensionRecord> => {
  const byPart = Object.fromEntries(images.map((built) => [built.part, built.image]));
  return validateRecord(recordOf(pkg, info, byPart, await recordExtras(dir, pkg)));
};

const writeRecord = async (
  dir: string,
  record: ExtensionRecord,
  file = join(dir, 'dist', RECORD_FILE)
) => {
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
};

const buildParts = async (
  base: Omit<PartJob, 'part' | 'tag'>,
  options: BuildOptions,
  deps: BuildDeps
): Promise<BuiltImage[]> => {
  const docker = deps.docker ?? createDocker(deps.run);
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const images: BuiltImage[] = [];
  for (const part of imageParts(base.pkg)) {
    const job = { ...base, part, tag: imageTag(registry, base.pkg, part) };
    await buildImage(job, docker, deps.tmpRoot);
    images.push(options.push ? await pushImage(job, docker) : { part, tag: job.tag });
  }
  return images;
};

// Validate, compile, check, one image per part from the kit recipe; --push pushes, writes the record.
export const build = async (
  options: BuildOptions = {},
  deps: BuildDeps = { run: runCommand }
): Promise<BuildResult> => {
  const dir = resolve(options.dir ?? '.');
  const pkg = await readManifest(dir);
  const info = await resolveBuildInfo(dir, options.env ?? process.env, deps.run);
  await compile(dir, pkg, deps.run);
  await assertConforms({ dir, pkg });
  const images = await buildParts({ dir, pkg, info }, options, deps);
  const result: BuildResult = { id: pkg.agentage.id, version: pkg.version, ...info, images };
  if (!options.push) return result;
  return { ...result, recordFile: await writeRecord(dir, await recordFor(dir, pkg, info, images)) };
};
