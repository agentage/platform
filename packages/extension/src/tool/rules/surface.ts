import { join } from 'node:path';
import { type PartContext } from '../../context/context.js';
import { OPENAPI_FILE, readOpenapi } from '../../discovery/openapi.js';
import { loadCreate } from '../../manifest/entry.js';
import { normalizeParts } from '../../manifest/parts.js';
import { readJsonIfExists } from '../../manifest/read-manifest.js';
import { canonical, type McpSnapshot } from '../../mcp/snapshot.js';
import { prefixed, type McpContext, type ToolEntry } from '../../mcp/tools.js';
import { type CheckInput, type CheckRule, type Finding } from '../check.js';
import { recordingContext, registeredTools } from '../record-extras.js';

type Json = Record<string, unknown>;
type Layer = { name: string; route?: { path: string; stack: { method: string }[] } };

const differing = (generated: Json, committed: Json): string[] =>
  [...new Set([...Object.keys(generated), ...Object.keys(committed)])].filter(
    (key) => JSON.stringify(canonical(generated[key])) !== JSON.stringify(canonical(committed[key]))
  );

const keyed = (keys: string[], version: unknown): Json => ({
  ...Object.fromEntries(keys.map((key) => [key, true])),
  'info.version': version,
});

// Express routes as OpenAPI keys; a middleware or sub-router hides routes, so it never matches one.
const servedRoutes = (router: unknown): string[] =>
  ((router as { stack?: Layer[] } | null)?.stack ?? []).flatMap(({ name, route }) => {
    if (!route) return [`${name} middleware`];
    const path = `/api/v1${route.path.replace(/:(\w+)/g, '{$1}')}`;
    return route.stack.map(({ method }) => `${method.toUpperCase()} ${path}`);
  });

const operations = (doc: Json): [string, Json][] =>
  Object.entries((doc['paths'] ?? {}) as Record<string, Json>).flatMap(([path, ops]) =>
    Object.entries(ops).map(([method, op]): [string, Json] => [
      `${method.toUpperCase()} ${path}`,
      op as Json,
    ])
  );

// security: [] is public; otherwise a requirement names at least one scope.
const declaresAccess = (security: unknown): boolean =>
  Array.isArray(security) &&
  (security.length === 0 ||
    security.some((need: Json) => Object.values(need ?? {}).some((s) => (s as []).length > 0)));

const apiProblems = (doc: Json, routes: string[], version: string): string[] => {
  const ops = operations(doc);
  const info = (doc['info'] as Json | undefined)?.['version'];
  const diff = differing(
    keyed(routes, version),
    keyed(
      ops.map(([key]) => key),
      info
    )
  );
  const open = ops.filter(([, op]) => !declaresAccess(op['security'] ?? doc['security']));
  return [
    ...(diff.length > 0 ? [`differs from the generated contract (${diff.join(', ')})`] : []),
    ...open.map(([key]) => `${key} declares neither a scope nor security: []`),
  ];
};

const apiSurface = async ({ dir, pkg }: CheckInput): Promise<Finding[]> => {
  const create = await loadCreate<PartContext>(dir, pkg, 'api').catch(() => null);
  if (!create) return [];
  const doc = await readOpenapi(dir);
  const found = doc
    ? apiProblems(doc, servedRoutes(await create(recordingContext(pkg, 'api'))), pkg.version)
    : ['is missing: the api part commits its contract'];
  return found.map((problem) => ({ file: OPENAPI_FILE, problem }));
};

type Listed = { '~standard': { jsonSchema: Record<'input' | 'output', (o: object) => Json> } };

// What the SDK lists for a tool: both schemas as JSON Schema 2020-12.
const listed = (id: string, { name, spec }: ToolEntry): Json => {
  const schema = (zod: object, io: 'input' | 'output') =>
    (zod as Listed)['~standard'].jsonSchema[io]({ target: 'draft-2020-12' });
  const { description, input, output } = spec;
  const inputSchema = schema(input, 'input');
  return {
    name: prefixed(id, name),
    description,
    inputSchema,
    outputSchema: schema(output, 'output'),
  };
};

const byName = ({ serverInfo, tools }: McpSnapshot): Json => ({
  serverInfo,
  ...Object.fromEntries(tools.map((tool) => [String(tool['name']), tool])),
});

const mcpSurface = async ({ dir, pkg }: CheckInput): Promise<Finding[]> => {
  const create = await loadCreate<McpContext>(dir, pkg, 'mcp').catch(() => null);
  if (!create) return [];
  const { id } = pkg.agentage;
  const file = `${id}.mcpc.json`;
  const committed = (await readJsonIfExists(join(dir, file))) as McpSnapshot | undefined;
  if (!committed) return [{ file, problem: 'is missing: the mcp part commits its tool list' }];
  const tools = (await registeredTools(create, pkg)).map((tool) => listed(id, tool));
  const serverInfo = { name: `agentage-${id}`, version: pkg.version };
  const diff = differing(byName({ serverInfo, tools }), byName(committed));
  const problem = `differs from the generated tool list (${diff.join(', ')})`;
  return diff.length > 0 ? [{ file, problem }] : [];
};

// The committed contracts equal what the code serves; entries names a part that does not load.
export const surface: CheckRule = {
  name: 'surface',
  run: async (input) => {
    const { code } = normalizeParts(input.pkg.agentage.parts);
    const api = code.api ? await apiSurface(input) : [];
    return [...api, ...(code.mcp ? await mcpSurface(input) : [])];
  },
};
