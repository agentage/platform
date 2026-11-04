import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { discoveryDocument } from '../../discovery/discovery.js';
import { DiscoveryDocumentSchema, type ExtensionRecord } from '../../discovery/discovery.schema.js';
import { formatIssues } from '../../manifest/read-manifest.js';
import { type ExtensionPackage } from '../../manifest/manifest.schema.js';
import { recordFor, type BuildResult, type BuiltImage } from '../build.js';
import { mustRun, type Run } from '../exec.js';

export const LOCAL_DIR = '.agentage';

// A local build has no registry digest; the image id from the daemon stands in for it (Q4).
const localImage = async (run: Run, built: BuiltImage): Promise<BuiltImage> => {
  const id = (
    await mustRun(run, 'docker', ['image', 'inspect', '-f', '{{.Id}}', built.tag])
  ).trim();
  const repository = built.tag.slice(0, built.tag.lastIndexOf(':'));
  return { ...built, digest: id, image: `${repository}@${id}` };
};

export const assertDiscoverable = (record: ExtensionRecord, origin: string): void => {
  const result = DiscoveryDocumentSchema.safeParse(discoveryDocument(record, origin));
  if (!result.success)
    throw new Error(`discovery would be invalid: ${formatIssues(result.error.issues)}`);
};

export const writeLocalRecord = async (
  dir: string,
  pkg: ExtensionPackage,
  built: BuildResult,
  run: Run
) => {
  const images = await Promise.all(built.images.map((image) => localImage(run, image)));
  const record = await recordFor(dir, pkg, built, images);
  await mkdir(join(dir, LOCAL_DIR), { recursive: true });
  const file = join(dir, LOCAL_DIR, 'record.json');
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return { file, record };
};
