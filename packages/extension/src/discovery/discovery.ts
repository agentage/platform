import { readFile } from 'node:fs/promises';
import { formatIssues } from '../manifest/read-manifest.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { normalizeParts } from '../manifest/parts.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { ExtensionRecordSchema, type ExtensionRecord } from './discovery.schema.js';

export interface BuildInfo {
  commit: string;
  buildTime: string;
}

export type PartImages = Partial<Record<ImagePartKind, string>>;

export const DEFAULT_RECORD_FILE = '/run/agentage/agentage-extension.json';

const commandNames = (pkg: ExtensionPackage): string[] | undefined => {
  const names = (pkg.agentage.commands ?? []).map((command) => command.name);
  return names.length > 0 ? names : undefined;
};

const partsOf = (pkg: ExtensionPackage, images: PartImages): ExtensionRecord['parts'] => {
  const parts: Record<string, unknown> = {};
  for (const [kind, image] of Object.entries(images)) parts[kind] = { image };
  const store = normalizeParts(pkg.agentage.parts).store;
  if (store) parts['store'] = { kind: store };
  return parts as ExtensionRecord['parts'];
};

// From the manifest, the build and the pushed images by digest; OpenAPI, tools, widgets come later.
export const recordOf = (pkg: ExtensionPackage, build: BuildInfo, images: PartImages) => {
  const record = {
    id: pkg.agentage.id,
    version: pkg.version,
    commit: build.commit,
    buildTime: build.buildTime,
    parts: partsOf(pkg, images),
    commands: commandNames(pkg),
  };
  return JSON.parse(JSON.stringify(record)) as ExtensionRecord;
};

export const validateRecord = (value: unknown): ExtensionRecord => {
  const result = ExtensionRecordSchema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`invalid extension record: ${formatIssues(result.error.issues)}`);
};

export const loadRecord = async (file: string): Promise<ExtensionRecord | null> => {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return null; // no record mounted: discovery lists the part's own image by tag
  }
  return validateRecord(JSON.parse(text) as unknown);
};

export const discoveryDocument = (record: ExtensionRecord, host: string) => {
  const { id, version, commit, buildTime, ...rest } = record;
  return { id, version, commit, buildTime, host, ...rest };
};
