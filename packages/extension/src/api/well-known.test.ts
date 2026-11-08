import { afterEach, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../testing/test-server.js';
import { type ApiContext } from './routes.js';
import { createWellKnownRegistry, type WellKnownName } from './well-known.js';

const create = ({ route, wellKnown }: ApiContext) => {
  route('get', '/ping', { summary: 'Ping', scope: 'public' }, () => 'pong');
  wellKnown('agentage.json', async () => ({ name: 'root' }));
  wellKnown('mcp-registry-auth', () => 'v=MCPv1; k=ed25519; p=key');
};

let server: TestServer | undefined;
afterEach(async () => server?.close());

describe('ctx.wellKnown', () => {
  it('serves JSON and text documents anonymously, public CORS, cached briefly', async () => {
    server = await startTestServer({ create });
    const json = await server.fetch('/.well-known/agentage.json', { headers: { origin: 'x' } });
    expect([json.headers.get('access-control-allow-origin'), await json.json()]).toEqual([
      '*',
      { name: 'root' },
    ]);
    expect(json.headers.get('cache-control')).toBe('public, max-age=300');
    const text = await server.fetch('/.well-known/mcp-registry-auth');
    expect(text.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await text.text()).toBe('v=MCPv1; k=ed25519; p=key');
  });

  it('refuses a name off the closed list and a name registered twice', () => {
    const { wellKnown } = createWellKnownRegistry();
    expect(() => wellKnown('security.txt' as WellKnownName, () => '')).toThrow(
      'well-known security.txt: one of agentage.json, mcp-registry-auth'
    );
    wellKnown('agentage.json', () => ({}));
    expect(() => wellKnown('agentage.json', () => ({}))).toThrow('registered twice');
  });
});
