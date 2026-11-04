import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonResponse, toolAnswer } from '../test-support/fetch.js';
import { callTool, PROTOCOL_VERSION, type ToolCallOptions } from './tool.js';

const options = (fetch: ToolCallOptions['fetch'], token?: string): ToolCallOptions => ({
  fetch,
  token: () => Promise.resolve(token),
  clientInfo: { name: 'agentage-harness', version: '0.1.0' },
  nextId: () => 7,
});

const echo = {
  content: [{ type: 'text', text: '{"msg":"pong hi"}' }],
  structuredContent: { msg: 'pong hi' },
};

describe('callTool', () => {
  it('POSTs a 2026-07-28 tools/call and resolves the structuredContent', async () => {
    const { fetch, calls } = fakeFetch(toolAnswer(echo, 7));
    await expect(callTool(options(fetch), 'probe__echo', { msg: 'hi' })).resolves.toEqual({
      msg: 'pong hi',
    });
    const [call] = calls;
    const headers = new Headers(call?.init.headers);
    expect(call?.url).toBe('/mcp');
    expect(call?.init.method).toBe('POST');
    expect(Object.fromEntries(headers)).toEqual({
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
      'mcp-method': 'tools/call',
      'mcp-name': 'probe__echo',
    });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'probe__echo',
        arguments: { msg: 'hi' },
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'agentage-harness', version: '0.1.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    });
  });

  it('sends the token as a bearer only when there is one', async () => {
    const { fetch, calls } = fakeFetch(toolAnswer(echo), toolAnswer(echo));
    await callTool(options(fetch, 'aga_x'), 'probe__echo', {});
    await callTool(options(fetch), 'probe__echo', {});
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe('Bearer aga_x');
    expect(new Headers(calls[1]?.init.headers).has('authorization')).toBe(false);
  });

  it('rejects with structuredContent.error code and message on isError', async () => {
    const failed = {
      isError: true,
      structuredContent: { error: { code: 'NOT_FOUND', message: 'gone' } },
    };
    const { fetch } = fakeFetch(toolAnswer(failed));
    await expect(callTool(options(fetch), 'probe__echo', {})).rejects.toMatchObject({
      name: 'HostError',
      code: 'NOT_FOUND',
      message: 'gone',
    });
  });

  it('falls back to the text content when an error has no structured error', async () => {
    const { fetch } = fakeFetch(
      toolAnswer({ isError: true, content: [{ type: 'image' }, { type: 'text', text: 'boom' }] }),
      toolAnswer({ isError: true })
    );
    await expect(callTool(options(fetch), 'probe__echo', {})).rejects.toMatchObject({
      code: 'TOOL_ERROR',
      message: 'boom',
    });
    await expect(callTool(options(fetch), 'probe__echo', {})).rejects.toMatchObject({
      code: 'TOOL_ERROR',
      message: 'the tool reported an error',
    });
  });

  it('maps a JSON-RPC error and an invalid result', async () => {
    const { fetch } = fakeFetch(
      jsonResponse({ jsonrpc: '2.0', id: 7, error: { code: -32602, message: 'bad args' } }, 400),
      toolAnswer({ isError: 'yes' })
    );
    await expect(callTool(options(fetch), 'probe__echo', {})).rejects.toMatchObject({
      code: '-32602',
      message: 'bad args',
    });
    await expect(callTool(options(fetch), 'probe__echo', {})).rejects.toMatchObject({
      code: 'BAD_RESULT',
    });
  });

  it('resolves {} for a result without structuredContent', async () => {
    const { fetch } = fakeFetch(toolAnswer({ content: [] }));
    await expect(callTool(options(fetch), 'probe__echo', {})).resolves.toEqual({});
  });

  it('accepts a text/event-stream answer and picks the message with its id', async () => {
    const stream = [
      'event: message',
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      'data: not json',
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 7, result: echo })}`,
      '',
    ].join('\n');
    const { fetch } = fakeFetch(jsonResponse(stream, 200, 'text/event-stream'));
    await expect(callTool(options(fetch), 'probe__echo', {})).resolves.toEqual({ msg: 'pong hi' });
  });

  it('rejects with the HTTP status when no JSON-RPC message comes back', async () => {
    const { fetch } = fakeFetch(jsonResponse('<html>bad gateway</html>', 502, 'text/html'));
    await expect(callTool(options(fetch), 'probe__echo', {})).rejects.toMatchObject({
      code: 'HTTP_502',
    });
  });
});
