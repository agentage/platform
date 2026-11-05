import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIssuer, type TestIssuer } from '../test-support/issuer.js';
import {
  authEnv,
  INSUFFICIENT,
  partPackage,
  postMcp,
  RESOURCE,
  rpc,
  startPart,
  STOP,
} from '../test-support/part-fixture.js';

let dir: string;
let issuer: TestIssuer;
beforeAll(async () => {
  dir = await partPackage();
});
beforeEach(async () => {
  issuer = await startIssuer();
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(async () => {
  process.emit(STOP, STOP);
  vi.restoreAllMocks();
  await issuer.close();
});

const start = (settings?: string) =>
  startPart(dir, 'mcp', { ...authEnv(issuer, dir), AGENTAGE_SETTINGS: settings });
const CALL = { name: 'probe__echo', arguments: { msg: 'hi' } };
const message = (id: number, method: string, params: object) => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
});

describe('an mcp part checks tokens (C5, C7)', () => {
  it('initialize, ping and tools/list are anonymous; tools/call needs probe:read', async () => {
    const url = await start();
    const init = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't' } };
    for (const [method, params] of [
      ['initialize', init],
      ['ping', {}],
      ['tools/list', {}],
    ] as const)
      expect((await rpc(url, method, params)).res.status, method).toBe(200);
    const none = await rpc(url, 'tools/call', CALL);
    expect([none.res.status, none.res.headers.get('www-authenticate')]).toEqual([401, RESOURCE]);
    const memory = await rpc(
      url,
      'tools/call',
      CALL,
      await issuer.bearer({ scope: 'memory:read' })
    );
    expect([memory.res.status, memory.res.headers.get('www-authenticate')]).toEqual([
      403,
      INSUFFICIENT,
    ]);
    const read = await issuer.bearer({ scope: 'probe:read' });
    expect((await rpc(url, 'tools/call', CALL, read)).body['result']).toMatchObject({
      structuredContent: { msg: 'pong hi' },
    });
  });

  it('a body the kit cannot read is a parse error, never a call without a check', async () => {
    const url = await start();
    const batch = [message(1, 'tools/list', {}), message(2, 'tools/call', CALL)];
    const parseError = {
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    };
    for (const body of [message(1, 'tools/call', CALL), batch]) {
      const bom = await postMcp(url, `﻿${JSON.stringify(body)}`);
      expect([bom.res.status, bom.body]).toEqual([400, parseError]);
    }
    expect((await postMcp(url, JSON.stringify(batch))).res.status).toBe(401);
  });

  it('a bad argument is a failed tool with the REST error shape', async () => {
    const url = await start();
    const read = await issuer.bearer({ scope: 'probe:read' });
    const bad = await rpc(url, 'tools/call', { name: 'probe__echo', arguments: { msg: 5 } }, read);
    expect(bad.res.status).toBe(200);
    expect(bad.body['result']).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Invalid arguments: msg' }],
      structuredContent: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid arguments: msg',
          agcid: expect.any(String),
        },
      },
    });
  });

  it('a closed listing (mcp.listing token) answers tools/list to probe:read only', async () => {
    const url = await start('{"mcp.listing":"token"}');
    expect((await rpc(url, 'tools/list', {})).res.status).toBe(401);
    const read = await issuer.bearer({ scope: 'probe:read' });
    const listed = await rpc(url, 'tools/list', {}, read);
    expect(listed.body['result']?.['tools']).toMatchObject([{ name: 'probe__echo' }]);
  });

  it('no key and the issuer down: tools/call is 503 with Retry-After 5', async () => {
    const read = await issuer.bearer({ scope: 'probe:read' });
    await issuer.close();
    const url = await start();
    const res = (await rpc(url, 'tools/call', CALL, read)).res;
    expect([res.status, res.headers.get('retry-after')]).toEqual([503, '5']);
  });
});
