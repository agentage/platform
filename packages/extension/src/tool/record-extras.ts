import { join } from 'node:path';
import { z } from 'zod';
import { scopeOf } from '../auth/token-check.js';
import { createContext } from '../context/context.js';
import { type RecordExtras } from '../discovery/discovery.js';
import { WidgetSchema } from '../discovery/discovery.schema.js';
import { OPENAPI_PATH, readOpenapi } from '../discovery/openapi.js';
import { createLog } from '../log/log.js';
import { loadCreate } from '../manifest/entry.js';
import { readJsonIfExists } from '../manifest/read-manifest.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { hasPostgres, normalizeParts } from '../manifest/parts.js';
import { createToolRegistry, prefixed, type McpContext } from '../mcp/tools.js';
import { sqlFiles } from '../store/migrations.js';
import { type Store } from '../store/store.types.js';

const WidgetsSchema = z.array(WidgetSchema).min(1);

const noStore: Store = {
  query: async () => {
    throw new Error('the store is not open while the tool reads a part');
  },
};

const silent = createLog({ extension: 'build', part: 'check' }, () => undefined);

// The ctx part code gets when the tool runs its create(ctx) to read what it registers or routes.
export const recordingContext = (pkg: ExtensionPackage, part: 'api' | 'mcp') =>
  createContext({
    pkg,
    part,
    origin: 'http://127.0.0.1',
    commit: '0'.repeat(40),
    log: silent,
    store: noStore,
  });

// The tools an mcp part's create(ctx) registers, run on a recorder.
export const registeredTools = async (
  create: (ctx: McpContext) => unknown,
  pkg: ExtensionPackage
) => {
  const registry = createToolRegistry();
  await create({ ...recordingContext(pkg, 'mcp'), tool: registry.tool });
  return registry.tools;
};

// The tools the mcp part registers and their scopes, for the record.
export const toolsOf = async (dir: string, pkg: ExtensionPackage) => {
  const tools = await registeredTools(await loadCreate<McpContext>(dir, pkg, 'mcp'), pkg);
  const { id } = pkg.agentage;
  return tools.map((tool) => ({
    name: prefixed(id, tool.name),
    scope: scopeOf(id, tool.spec.scope),
  }));
};

const widgetsOf = async (dir: string) => {
  const value = await readJsonIfExists(join(dir, 'dist', 'ui', 'widgets.json'));
  return value === undefined ? undefined : WidgetsSchema.parse(value);
};

// What the code serves, for the record: tools, widgets and the migration count.
export const recordExtras = async (dir: string, pkg: ExtensionPackage): Promise<RecordExtras> => {
  const { code } = normalizeParts(pkg.agentage.parts);
  const extras: RecordExtras = {};
  if (code.mcp) {
    const tools = await toolsOf(dir, pkg);
    if (tools.length > 0) extras.tools = tools;
  }
  if (code.ui) extras.widgets = await widgetsOf(dir);
  if (code.api && (await readOpenapi(dir))) extras.openapi = OPENAPI_PATH;
  if (hasPostgres(pkg)) extras.migrations = (await sqlFiles(join(dir, 'migrations'))).length;
  return extras;
};
