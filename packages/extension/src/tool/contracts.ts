import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { OPENAPI_FILE } from '../discovery/openapi.js';
import { loadCreate } from '../manifest/entry.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { normalizeParts } from '../manifest/parts.js';
import { readManifest } from '../manifest/read-manifest.js';
import { canonical } from '../mcp/snapshot.js';
import { type McpContext } from '../mcp/tools.js';
import { generatedMcp } from './rules/surface.js';

const readText = (file: string) => readFile(file, 'utf8').catch(() => undefined);

const sameJson = (text: string | undefined, value: unknown): boolean =>
  text !== undefined &&
  JSON.stringify(canonical(JSON.parse(text))) === JSON.stringify(canonical(value));

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const writeMcp = async (dir: string, pkg: ExtensionPackage): Promise<string[]> => {
  const file = `${pkg.agentage.id}.mcpc.json`;
  const create = await loadCreate<McpContext>(dir, pkg, 'mcp');
  const snapshot = canonical(await generatedMcp(create, pkg));
  if (sameJson(await readText(join(dir, file)), snapshot)) return [];
  await writeFile(join(dir, file), json(snapshot));
  return [file];
};

const INFO_VERSION = /("info"\s*:\s*\{[^{}]*?"version"\s*:\s*)"[^"]*"/;

// Only info.version, in place so the file keeps its formatting; openapi generation is 0.6.
const writeOpenapiVersion = async (dir: string, version: string): Promise<string[]> => {
  const file = join(dir, OPENAPI_FILE);
  const text = await readText(file);
  if (text === undefined) return [];
  const doc = JSON.parse(text) as { info?: Record<string, unknown> };
  if (doc.info?.version === version) return [];
  const inPlace = text.replace(INFO_VERSION, `$1${JSON.stringify(version)}`);
  await writeFile(
    file,
    inPlace !== text ? inPlace : json({ ...doc, info: { ...doc.info, version } })
  );
  return [OPENAPI_FILE];
};

// check --write: the committed contracts regenerated from the built code; returns the files it changed.
export const writeContracts = async (at: string): Promise<string[]> => {
  const dir = resolve(at);
  const pkg = await readManifest(dir);
  const { code } = normalizeParts(pkg.agentage.parts);
  const mcp = code.mcp ? await writeMcp(dir, pkg) : [];
  return [...mcp, ...(code.api ? await writeOpenapiVersion(dir, pkg.version) : [])];
};
