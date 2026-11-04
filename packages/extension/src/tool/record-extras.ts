import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createContext } from '../context/context.js';
import { type RecordExtras } from '../discovery/discovery.js';
import { OPENAPI_PATH, readOpenapi } from '../discovery/openapi.js';
import { createLog } from '../log/log.js';
import { readJsonIfExists } from '../manifest/read-manifest.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { entryOf, normalizeParts } from '../manifest/parts.js';
import { createToolRegistry, prefixed } from '../mcp/tools.js';
import { sqlFiles } from '../store/migrations.js';
import { type Store } from '../store/store.types.js';

const WidgetsSchema = z
  .array(z.strictObject({ name: z.string(), element: z.string(), module: z.string() }))
  .min(1);

const noStore: Store = {
  query: async () => {
    throw new Error('the store is not open while the build lists tools');
  },
};

const silent = createLog({ extension: 'build', part: 'mcp' }, () => undefined);

// The tool names the mcp part registers, read by running its create(ctx) with a recording ctx.
export const toolNames = async (dir: string, pkg: ExtensionPackage): Promise<string[]> => {
  const registry = createToolRegistry();
  const base = createContext({
    pkg,
    part: 'mcp',
    origin: 'http://127.0.0.1',
    commit: '0'.repeat(40),
    log: silent,
    store: noStore,
  });
  const mod = (await import(pathToFileURL(join(dir, entryOf(pkg, 'mcp'))).href)) as {
    create?: unknown;
  };
  if (typeof mod.create !== 'function')
    throw new Error('the mcp entry does not export create(ctx)');
  await (mod.create as (ctx: unknown) => unknown)({ ...base, tool: registry.tool });
  return registry.tools.map((tool) => prefixed(pkg.agentage.id, tool.name));
};

const widgetsOf = async (dir: string) => {
  const value = await readJsonIfExists(join(dir, 'dist', 'ui', 'widgets.json'));
  return value === undefined ? undefined : WidgetsSchema.parse(value);
};

// What the code serves, for the record: tools, widgets and the migration count.
export const recordExtras = async (dir: string, pkg: ExtensionPackage): Promise<RecordExtras> => {
  const { code, store } = normalizeParts(pkg.agentage.parts);
  const extras: RecordExtras = {};
  if (code.mcp) {
    const tools = await toolNames(dir, pkg);
    if (tools.length > 0) extras.tools = tools;
  }
  if (code.ui) extras.widgets = await widgetsOf(dir);
  if (code.api && (await readOpenapi(dir))) extras.openapi = OPENAPI_PATH;
  if (store === 'postgres') extras.migrations = (await sqlFiles(join(dir, 'migrations'))).length;
  return extras;
};
