import { scopeOf } from '../auth/token-check.js';
import { ErrorEnvelopeSchema } from '../envelope/envelope.schema.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type RouteEntry } from './routes.js';

type Json = Record<string, unknown>;
type Listed = { '~standard': { jsonSchema: Record<'input' | 'output', (o: object) => Json> } };

// Through Standard Schema, so an author's own zod copy lists like the kit's.
export const schemaOf = (zod: object, io: 'input' | 'output'): Json =>
  (zod as Listed)['~standard'].jsonSchema[io]({ target: 'draft-2020-12' });

const bare = (zod: object, io: 'input' | 'output'): Json => {
  const schema = { ...schemaOf(zod, io) };
  delete schema['$schema'];
  return schema;
};

const json = (schema: Json) => ({ 'application/json': { schema } });

const content = (description: string, schema: Json) => ({ description, content: json(schema) });

const okResponse = (output: object | undefined) =>
  content('the envelope', {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: true },
      data: output ? bare(output, 'output') : {},
    },
    required: ['success', 'data'],
  });

const INVALID = content('VALIDATION_ERROR', bare(ErrorEnvelopeSchema, 'input'));

const inQuery = ({ method }: RouteEntry) => method === 'get' || method === 'delete';

const parameters = (entry: RouteEntry): Json[] => {
  const path = [...entry.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  if (!entry.spec.input || !inQuery(entry)) return path;
  const { properties = {}, required = [] } = bare(entry.spec.input, 'input') as {
    properties?: Json;
    required?: string[];
  };
  const query = Object.entries(properties).map(([name, schema]) => ({
    name,
    in: 'query',
    required: required.includes(name),
    schema,
  }));
  return [...path, ...query];
};

const securityOf = (id: string, scope: RouteEntry['spec']['scope']): Json[] => {
  if (scope === 'public') return [];
  // The empty requirement lets a call through anonymous; a bearer sent must grant read.
  if (scope === 'optional') return [{}, { pat: [scopeOf(id, 'read')] }];
  return [{ pat: [scopeOf(id, scope)] }];
};

const operation = (id: string, entry: RouteEntry): Json => {
  const { summary, scope, input, output } = entry.spec;
  const params = parameters(entry);
  return {
    summary,
    security: securityOf(id, scope),
    ...(params.length > 0 && { parameters: params }),
    ...(input &&
      !inQuery(entry) && { requestBody: { required: true, content: json(bare(input, 'input')) } }),
    responses: { '200': okResponse(output), ...(input && { '400': INVALID }) },
  };
};

// The api's contract from its ctx.route declarations: what openapi.json must hold.
export const generatedOpenapi = (pkg: ExtensionPackage, routes: RouteEntry[]): Json => {
  const { id } = pkg.agentage;
  const paths: Record<string, Json> = {};
  for (const entry of routes) {
    const at = `/api/v1${entry.path}`;
    paths[at] = { ...paths[at], [entry.method]: operation(id, entry) };
  }
  return {
    openapi: '3.1.0',
    info: { title: id, version: pkg.version },
    components: { securitySchemes: { pat: { type: 'http', scheme: 'bearer' } } },
    paths,
  };
};
