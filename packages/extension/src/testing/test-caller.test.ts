import { afterEach, describe, expect, it } from 'vitest';
import { type ApiContext } from '../api/routes.js';
import { type Caller } from '../auth/token-check.js';
import { startTestServer, type TestServer } from './test-server.js';

const create = ({ route }: ApiContext) => {
  route('get', '/open', { summary: 'Open', scope: 'public' }, ({ caller }) => caller?.sub ?? null);
  route(
    'get',
    '/maybe',
    { summary: 'Maybe', scope: 'optional' },
    ({ caller }) => caller?.sub ?? null
  );
  route('get', '/read', { summary: 'Read' }, ({ caller }) => caller.sub);
  route('post', '/write', { summary: 'Write', scope: 'write' }, () => 'written');
};

let server: TestServer | undefined;
afterEach(async () => server?.close());

const statuses = async (caller: Caller | null) => {
  server = await startTestServer({ create, caller });
  const paths = ['/open', '/maybe', '/read'];
  const reads = await Promise.all(paths.map((path) => server!.fetch(`/api/v1${path}`)));
  const write = await server.fetch('/api/v1/write', { method: 'POST' });
  return [...reads, write].map((res) => res.status);
};

describe('startTestServer({ caller })', () => {
  it('as a read caller: each route gets the caller, write is 403', async () => {
    expect(await statuses({ sub: 'usr_1', scopes: ['test:read'] })).toEqual([200, 200, 200, 403]);
    expect(await (await server!.fetch('/api/v1/maybe')).json()).toEqual({
      success: true,
      data: 'usr_1',
    });
  });

  it('as anonymous: public and optional answer with no caller, the scoped routes 401', async () => {
    expect(await statuses(null)).toEqual([200, 200, 401, 401]);
    expect(await (await server!.fetch('/api/v1/open')).json()).toEqual({
      success: true,
      data: null,
    });
  });

  it('answers an unmatched path 404 before any token check, anonymous too', async () => {
    server = await startTestServer({ create, caller: null });
    expect((await server.fetch('/api/v1/machines')).status).toBe(404);
    expect((await server.fetch('/api/v1/read')).status).toBe(401);
  });
});
