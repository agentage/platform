import { scopeOf } from '../auth/token-check.js';
import { type ErrorCode } from '../envelope/codes.js';
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

const STRING = { type: 'string' };

const okResponse = (spec: RouteEntry['spec']) =>
  spec.status === 204 ? { description: 'no content' } : okBody(spec);

const okBody = ({ output, etag }: RouteEntry['spec']) => ({
  ...content('the envelope', {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: true },
      data: output ? bare(output, 'output') : {},
    },
    required: ['success', 'data'],
  }),
  ...(etag && { headers: { ETag: { schema: STRING } } }),
});

const refusal = (code: ErrorCode) => content(code, { $ref: '#/components/schemas/Error' });

export const inQuery = (method: string): boolean => method === 'get' || method === 'delete';

const fields = (zod: object) =>
  bare(zod, 'input') as { properties?: Record<string, Json>; required?: string[] };

const pathParameters = ({ path, spec }: RouteEntry): Json[] => {
  const typed = spec.params ? (fields(spec.params).properties ?? {}) : {};
  return [...path.matchAll(/\{(\w+)\}/g)].map(([, name = '']) => ({
    name,
    in: 'path',
    required: true,
    schema: typed[name] ?? STRING,
  }));
};

const queryParameters = (entry: RouteEntry): Json[] => {
  if (!entry.spec.input || !inQuery(entry.method)) return [];
  const { properties = {}, required = [] } = fields(entry.spec.input);
  return Object.entries(properties).map(([name, schema]) => ({
    name,
    in: 'query',
    required: required.includes(name),
    schema,
  }));
};

const IF_MATCH = { name: 'If-Match', in: 'header', required: false, schema: STRING };

const parameters = (entry: RouteEntry): Json[] => [
  ...pathParameters(entry),
  ...queryParameters(entry),
  ...(entry.spec.etag ? [IF_MATCH] : []),
];

const responses = (entry: RouteEntry): Json => {
  const { input, params, scope, etag } = entry.spec;
  return {
    [entry.spec.status ?? 200]: okResponse(entry.spec),
    ...((input || params) && { '400': refusal('VALIDATION_ERROR') }),
    ...(scope !== 'public' && { '401': refusal('UNAUTHORIZED'), '403': refusal('FORBIDDEN') }),
    ...(entry.path.includes('{') && { '404': refusal('NOT_FOUND') }),
    // If-Match absent on a PUT overwrites (no 428); only a stale tag is refused.
    ...(etag && { '412': refusal('PRECONDITION_FAILED') }),
  };
};

const securityOf = (id: string, scope: RouteEntry['spec']['scope']): Json[] => {
  if (scope === 'public') return [];
  // The empty requirement lets a call through anonymous; a bearer sent must grant read.
  if (scope === 'optional') return [{}, { pat: [scopeOf(id, 'read')] }];
  return [{ pat: [scopeOf(id, scope)] }];
};

const operation = (id: string, entry: RouteEntry): Json => {
  const { summary, scope, input } = entry.spec;
  const params = parameters(entry);
  return {
    summary,
    security: securityOf(id, scope),
    ...(params.length > 0 && { parameters: params }),
    ...(input &&
      !inQuery(entry.method) && {
        requestBody: { required: true, content: json(bare(input, 'input')) },
      }),
    responses: responses(entry),
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
    components: {
      securitySchemes: { pat: { type: 'http', scheme: 'bearer' } },
      schemas: { Error: bare(ErrorEnvelopeSchema, 'input') },
    },
    paths,
  };
};
