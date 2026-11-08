import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_MANIFEST } from '../test-support/packages.js';
import { generatedOpenapi } from './openapi-doc.js';
import { createRouteRegistry } from './routes.js';

const Msg = z.object({ msg: z.string().max(9) });
const MSG_JSON = {
  type: 'object',
  properties: { msg: { type: 'string', maxLength: 9 } },
  required: ['msg'],
};
type Response = {
  description: string;
  content: Record<string, { schema: { properties: { data: unknown } } }>;
};

const doc = () => {
  const { route, routes } = createRouteRegistry();
  route('get', '/echo', { summary: 'Echo', input: Msg, output: Msg }, ({ input }) => input);
  route('get', '/ping', { summary: 'Ping', scope: 'public' }, () => 'pong');
  route('put', '/items/{id}', { summary: 'Put', scope: 'write', input: Msg }, () => null);
  const params = z.object({ n: z.string().max(3) });
  route('put', '/docs/{n}', { summary: 'Doc', scope: 'optional', params, etag: true }, () => null);
  return generatedOpenapi(API_MANIFEST, routes) as {
    info: unknown;
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
};

describe('generatedOpenapi', () => {
  it('names the package, the bearer scheme and each route under /api/v1', () => {
    const { info, paths } = doc();
    expect(info).toEqual({ title: API_MANIFEST.agentage.id, version: API_MANIFEST.version });
    expect(Object.keys(paths)).toEqual([
      '/api/v1/echo',
      '/api/v1/ping',
      '/api/v1/items/{id}',
      '/api/v1/docs/{n}',
    ]);
  });

  it('turns the scope into security: read by default, [] when public', () => {
    const { paths } = doc();
    const id = API_MANIFEST.agentage.id;
    expect(paths['/api/v1/echo']?.['get']?.['security']).toEqual([{ pat: [`${id}:read`] }]);
    expect(paths['/api/v1/ping']?.['get']?.['security']).toEqual([]);
    expect(paths['/api/v1/items/{id}']?.['put']?.['security']).toEqual([{ pat: [`${id}:write`] }]);
  });

  it('lists a get input as query parameters, a put input as the body, path params as strings', () => {
    const { paths } = doc();
    const echo = paths['/api/v1/echo']?.['get'];
    expect(echo?.['parameters']).toEqual([
      { name: 'msg', in: 'query', required: true, schema: { type: 'string', maxLength: 9 } },
    ]);
    const put = paths['/api/v1/items/{id}']?.['put'];
    expect(put?.['parameters']).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
    expect(put?.['requestBody']).toEqual({
      required: true,
      content: { 'application/json': { schema: MSG_JSON } },
    });
  });

  it('wraps the output in the envelope, adds 400 only for a route with input', () => {
    const { paths } = doc();
    const responses = paths['/api/v1/echo']?.['get']?.['responses'] as Record<string, Response>;
    expect(responses['200']!.content['application/json']!.schema.properties.data).toEqual({
      ...MSG_JSON,
      additionalProperties: false,
    });
    expect(responses['400']?.description).toBe('VALIDATION_ERROR');
    const ping = paths['/api/v1/ping']?.['get']?.['responses'] as Record<string, Response>;
    expect([
      Object.keys(ping),
      ping['200']!.content['application/json']!.schema.properties.data,
    ]).toEqual([['200'], {}]);
  });

  it('lists the refusals a route can answer: 401 and 403 when scoped, 404 with a param', () => {
    const { paths } = doc();
    const codes = (path: string, method: string) =>
      Object.keys(paths[path]?.[method]?.['responses'] as object);
    expect(codes('/api/v1/echo', 'get')).toEqual(['200', '400', '401', '403']);
    expect(codes('/api/v1/items/{id}', 'put')).toEqual(['200', '400', '401', '403', '404']);
    const put = paths['/api/v1/items/{id}']?.['put']?.['responses'] as Record<string, Response>;
    expect(put['404']).toEqual({
      description: 'NOT_FOUND',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
    });
  });

  it('an etag route takes If-Match, answers ETag and 412; optional is anonymous or read', () => {
    const generated = doc() as ReturnType<typeof doc> & { components: { schemas: object } };
    const put = generated.paths['/api/v1/docs/{n}']?.['put'];
    expect(put?.['security']).toEqual([{}, { pat: [`${API_MANIFEST.agentage.id}:read`] }]);
    expect(put?.['parameters']).toEqual([
      { name: 'n', in: 'path', required: true, schema: { type: 'string', maxLength: 3 } },
      { name: 'If-Match', in: 'header', required: false, schema: { type: 'string' } },
    ]);
    const responses = put?.['responses'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(responses)).toEqual(['200', '400', '401', '403', '404', '412']);
    expect(responses['200']?.['headers']).toEqual({ ETag: { schema: { type: 'string' } } });
    expect(Object.keys(generated.components.schemas)).toEqual(['Error']);
  });
});
