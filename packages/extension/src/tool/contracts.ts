import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { generatedOpenapi } from '../api/openapi-doc.js';
import { type ApiContext } from '../api/routes.js';
import { OPENAPI_FILE } from '../discovery/openapi.js';
import { loadCreate } from '../manifest/entry.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { normalizeParts } from '../manifest/parts.js';
import { readManifest } from '../manifest/read-manifest.js';
import { canonical } from '../mcp/snapshot.js';
import { type McpContext } from '../mcp/tools.js';
import { NOT_BUILT } from './check.js';
import { registeredRoutes } from './record-extras.js';
import { generatedMcp } from './rules/surface.js';
import { exists } from './stage.js';

const readText = (file: string) => readFile(file, 'utf8').catch(() => undefined);

// A file a run left half-written is not the same: --write replaces it.
const sameJson = (text: string | undefined, value: unknown): boolean => {
  try {
    return (
      text !== undefined &&
      JSON.stringify(canonical(JSON.parse(text))) === JSON.stringify(canonical(value))
    );
  } catch {
    return false;
  }
};

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

// Only info.version, in place so the file keeps its formatting; check reports any other drift.
const writeOpenapiVersion = async (dir: string, version: string): Promise<string[]> => {
  const file = join(dir, OPENAPI_FILE);
  const text = await readText(file);
  if (text === undefined) return [];
  const inPlace = text.replace(INFO_VERSION, `$1${JSON.stringify(version)}`);
  if (inPlace === text) return [];
  await writeFile(file, inPlace);
  return [OPENAPI_FILE];
};

// A ctx.route api: the whole document from its routes; a router api: only info.version.
const writeOpenapi = async (dir: string, pkg: ExtensionPackage): Promise<string[]> => {
  const create = await loadCreate<ApiContext>(dir, pkg, 'api');
  const { routes } = await registeredRoutes(create, pkg);
  if (routes.length === 0) return writeOpenapiVersion(dir, pkg.version);
  const doc = generatedOpenapi(pkg, routes);
  if (sameJson(await readText(join(dir, OPENAPI_FILE)), doc)) return [];
  await writeFile(join(dir, OPENAPI_FILE), json(doc));
  return [OPENAPI_FILE];
};

// check --write: the committed contracts regenerated from the built code; returns the files it changed.
export const writeContracts = async (at: string): Promise<string[]> => {
  const dir = resolve(at);
  const pkg = await readManifest(dir);
  if (!(await exists(join(dir, 'dist')))) throw new Error(`dist ${NOT_BUILT}`);
  const { code } = normalizeParts(pkg.agentage.parts);
  const mcp = code.mcp ? await writeMcp(dir, pkg) : [];
  return [...mcp, ...(code.api ? await writeOpenapi(dir, pkg) : [])];
};
