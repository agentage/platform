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

export interface RecordExtras {
  openapi?: string;
  tools?: string[];
  widgets?: { name: string; element: string; module: string }[];
  migrations?: number;
}

const partsOf = (pkg: ExtensionPackage, images: PartImages, migrations?: number) => {
  const parts: Record<string, unknown> = {};
  for (const [kind, image] of Object.entries(images)) parts[kind] = { image };
  const store = normalizeParts(pkg.agentage.parts).store;
  if (store)
    parts['store'] = migrations === undefined ? { kind: store } : { kind: store, migrations };
  return parts as ExtensionRecord['parts'];
};

// From the manifest, the build, the images by digest and what the code serves; OpenAPI comes later.
export const recordOf = (
  pkg: ExtensionPackage,
  build: BuildInfo,
  images: PartImages,
  extras: RecordExtras = {}
): ExtensionRecord => {
  const { id, commands } = pkg.agentage;
  const { commit, buildTime } = build;
  const parts = partsOf(pkg, images, extras.migrations);
  const record: ExtensionRecord = { id, version: pkg.version, commit, buildTime, parts };
  if (extras.openapi) record.openapi = extras.openapi;
  if (extras.tools) record.tools = extras.tools;
  if (commands) record.commands = commands.map((command) => command.name);
  if (extras.widgets) record.widgets = extras.widgets;
  return record;
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
