import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { fail, ok, reply } from '../envelope/envelope.js';
import { ErrorEnvelopeSchema } from '../envelope/envelope.schema.js';
import { startTestServer, type TestServer } from '../testing/test-server.js';
import { createRouteRegistry, type ApiContext } from './routes.js';

const Msg = z.object({ msg: z.string().min(1) });

const create = ({ route }: ApiContext) => {
  route('get', '/echo', { summary: 'Echo', input: Msg, output: Msg }, ({ input }) => input);
  route('get', '/who', { summary: 'Scoped caller' }, ({ caller }) => caller.sub);
  route('get', '/me', { summary: 'Caller', scope: 'public' }, ({ caller }) => caller?.sub);
  route('post', '/items/{id}', { summary: 'Item', scope: 'write', input: Msg }, (req) => ({
    id: req.params.id,
    msg: req.input.msg,
  }));
  route('put', '/doc', { summary: 'Doc', scope: 'write' }, ({ ifMatch }) =>
    reply({ ifMatch }, { etag: '"v2"', meta: { at: 2 } })
  );
  const Num = z.object({ n: z.string().regex(/^[0-9]+$/) });
  route('get', '/n/{n}', { summary: 'N', params: Num }, ({ params }) => params.n);
  route('post', '/made', { summary: 'Made', scope: 'write', status: 201 }, () =>
    reply({ made: true }, { status: 201 })
  );
  route('delete', '/gone', { summary: 'Gone', scope: 'write', status: 204 }, () =>
    reply(null, { status: 204 })
  );
  route('get', '/hdr', { summary: 'Header' }, ({ header }) => header('x-agentage-cli-version'));
  route('put', '/stale', { summary: 'Stale', scope: 'write' }, () => {
    throw fail('PRECONDITION_FAILED', 'Stale', { details: { current: 1, etag: '"v1"' } });
  });
  route('get', '/m', { summary: 'Missing' }, () => {
    throw fail('NOT_FOUND', 'No machine', { code: 'MACHINE_NOT_FOUND' });
  });
  const Tok = z.object({ email: z.string().min(1) });
  route('post', '/unsub', { summary: 'Unsub', scope: 'public', query: Tok }, ({ query, ip }) => ({
    email: query.email,
    ip,
  }));
  route('get', '/broken', { summary: 'Breaks', output: Msg }, () => ({ msg: 1 }) as never);
};

let server: TestServer | undefined;
afterEach(async () => server?.close());

const start = async () => (server = await startTestServer({ create }));
const post = (body: string) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});

describe('ctx.route', () => {
  it('validates the query, hands the caller and answers in the envelope', async () => {
    await start();
    expect(await (await server!.fetch('/api/v1/echo?msg=hi')).json()).toEqual({
      success: true,
      data: { msg: 'hi' },
    });
    expect(await (await server!.fetch('/api/v1/who')).json()).toEqual(ok('usr_test'));
    expect(await (await server!.fetch('/api/v1/me')).json()).toEqual({
      success: true,
      data: 'usr_test',
    });
  });

  it('takes the JSON body and the typed path params on post', async () => {
    await start();
    const res = await server!.fetch('/api/v1/items/i1', post('{"msg":"x"}'));
    expect(await res.json()).toEqual({ success: true, data: { id: 'i1', msg: 'x' } });
  });

  it('sends a reply with its ETag and meta, and hands the handler If-Match', async () => {
    await start();
    const res = await server!.fetch('/api/v1/doc', {
      method: 'PUT',
      headers: { 'If-Match': '"v1"' },
    });
    expect(res.headers.get('etag')).toBe('"v2"');
    expect(await res.json()).toEqual(ok({ ifMatch: '"v1"' }, { at: 2 }));
    const bare = await server!.fetch('/api/v1/doc', { method: 'PUT' });
    expect([bare.headers.get('access-control-expose-headers'), await bare.json()]).toEqual([
      expect.stringContaining('ETag'),
      ok({}, { at: 2 }),
    ]);
  });

  it('answers VALIDATION_ERROR with details, INTERNAL on a bad answer, NOT_FOUND off the routes', async () => {
    await start();
    const query = await server!.fetch('/api/v1/echo?msg=', { headers: { agcid: 'route-test-1' } });
    expect([query.status, ErrorEnvelopeSchema.parse(await query.json()).error]).toEqual([
      400,
      {
        code: 'VALIDATION_ERROR',
        message: 'Invalid query',
        agcid: 'route-test-1',
        details: [{ field: 'msg', message: expect.any(String) }],
      },
    ]);
    expect(await (await server!.fetch('/api/v1/n/42')).json()).toEqual(ok('42'));
    const path = await server!.fetch('/api/v1/n/x');
    expect(ErrorEnvelopeSchema.parse(await path.json()).error.message).toBe('Invalid path');
    const body = await server!.fetch('/api/v1/items/i1', post('{}'));
    expect(ErrorEnvelopeSchema.parse(await body.json()).error.message).toBe('Invalid body');
    expect((await server!.fetch('/api/v1/broken')).status).toBe(500);
    const off = await server!.fetch('/api/v1/nope', { headers: { agcid: 'route-test-2' } });
    expect([off.status, ErrorEnvelopeSchema.parse(await off.json()).error]).toEqual([
      404,
      { code: 'NOT_FOUND', message: 'Not found', agcid: 'route-test-2' },
    ]);
  });

  it('refuses routes and a returned router together', async () => {
    const both = (ctx: ApiContext) => {
      create(ctx);
      return Router();
    };
    await expect(startTestServer({ create: both })).rejects.toThrow('pick one');
  });

  it('refuses an api part that registers nothing and returns no router', async () => {
    await expect(startTestServer({ create: () => undefined })).rejects.toThrow('registers nothing');
  });

  it('keeps a returned router working', async () => {
    const router = Router().get('/old', (_req, res) => void res.json({ old: true }));
    server = await startTestServer({ create: () => router, ctx: createTestContext() });
    expect(await (await server.fetch('/api/v1/old')).json()).toEqual({ old: true });
  });
});

describe('the route registry', () => {
  const { route } = createRouteRegistry();
  route('get', '/one', { summary: 'One' }, () => 1);

  it.each([
    ['trace', '/x', {}, 'method trace'],
    ['get', 'x', {}, 'path'],
    ['get', '/x/:id', {}, 'path'],
    ['get', '/one', {}, 'is registered twice'],
    ['get', '/x', { summary: '' }, 'needs a summary'],
    ['get', '/x', { scope: 'owner' }, 'scope owner'],
  ])('refuses %s %s', (method, path, spec, message) => {
    const register = route as (...args: unknown[]) => void;
    expect(() => register(method, path, { summary: 'S', ...spec }, () => 1)).toThrow(message);
  });

  it('sends 201, and 204 without a body', async () => {
    await start();
    const made = await server!.fetch('/api/v1/made', { method: 'POST' });
    expect([made.status, await made.json()]).toEqual([201, ok({ made: true })]);
    const gone = await server!.fetch('/api/v1/gone', { method: 'DELETE' });
    expect([gone.status, await gone.text()]).toEqual([204, '']);
  });

  it('hands the handler a case-insensitive header', async () => {
    await start();
    const res = await server!.fetch('/api/v1/hdr', {
      headers: { 'X-Agentage-CLI-Version': '1.2' },
    });
    expect((await res.json()) as unknown).toEqual(ok('1.2'));
  });

  it('carries object details and a 4xx code override', async () => {
    await start();
    const stale = await server!.fetch('/api/v1/stale', { method: 'PUT' });
    expect([stale.status, ((await stale.json()) as { error: unknown }).error]).toEqual([
      412,
      expect.objectContaining({
        code: 'PRECONDITION_FAILED',
        details: { current: 1, etag: '"v1"' },
      }),
    ]);
    const missing = await server!.fetch('/api/v1/m');
    expect([missing.status, ((await missing.json()) as { error: unknown }).error]).toEqual([
      404,
      expect.objectContaining({ code: 'MACHINE_NOT_FOUND' }),
    ]);
  });

  it('refuses a lower-case or 5xx code override', () => {
    expect(() => fail('NOT_FOUND', 'x', { code: 'machine' })).toThrow(/UPPER_SNAKE/);
    expect(() => fail('INTERNAL', 'x', { code: 'BOOM' })).toThrow(/4xx/);
  });

  it('parses the query on a post and hands the client ip', async () => {
    await start();
    const res = await server!.fetch('/api/v1/unsub?email=a%40b.c', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(await res.json()).toEqual(ok({ email: 'a@b.c', ip: '203.0.113.7' }));
    expect((await server!.fetch('/api/v1/unsub', { method: 'POST' })).status).toBe(400);
  });
});
