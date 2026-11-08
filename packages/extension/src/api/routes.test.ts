import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createTestContext } from '../context/test-context.js';
import { ErrorEnvelopeSchema } from '../envelope/envelope.schema.js';
import { startTestServer, type TestServer } from '../testing/test-server.js';
import { createRouteRegistry, type ApiContext } from './routes.js';

const Msg = z.object({ msg: z.string().min(1) });

const create = ({ route }: ApiContext) => {
  route('get', '/echo', { summary: 'Echo', input: Msg, output: Msg }, ({ input }) => input);
  route('get', '/me', { summary: 'Caller', scope: 'public' }, ({ caller }) => caller?.sub);
  route('post', '/items/{id}', { summary: 'Item', scope: 'write', input: Msg }, (req) => ({
    id: req.params.id,
    msg: req.input.msg,
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
});
