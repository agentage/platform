import { formatIssues, readJsonIfExists } from '../manifest/read-manifest.js';
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

const partsOf = (pkg: ExtensionPackage, images: PartImages): ExtensionRecord['parts'] => {
  const parts: Record<string, unknown> = {};
  for (const [kind, image] of Object.entries(images)) parts[kind] = { image };
  const store = normalizeParts(pkg.agentage.parts).store;
  if (store) parts['store'] = { kind: store };
  return parts as ExtensionRecord['parts'];
};

// From the manifest, the build and the pushed images by digest; OpenAPI, tools, widgets come later.
export const recordOf = (
  pkg: ExtensionPackage,
  build: BuildInfo,
  images: PartImages
): ExtensionRecord => {
  const { id, commands } = pkg.agentage;
  const { commit, buildTime } = build;
  const record = { id, version: pkg.version, commit, buildTime, parts: partsOf(pkg, images) };
  return commands ? { ...record, commands: commands.map((command) => command.name) } : record;
};

export const validateRecord = (value: unknown): ExtensionRecord => {
  const result = ExtensionRecordSchema.safeParse(value);
  if (result.success) return result.data;
  throw new Error(`invalid extension record: ${formatIssues(result.error.issues)}`);
};

// No file means no record is mounted; any other read error stops the part from starting.
export const loadRecord = async (file: string): Promise<ExtensionRecord | null> => {
  const record = await readJsonIfExists(file);
  return record === undefined ? null : validateRecord(record);
};

export const discoveryDocument = (record: ExtensionRecord, host: string) => {
  const { id, version, commit, buildTime, ...rest } = record;
  return { id, version, commit, buildTime, host, ...rest };
};
