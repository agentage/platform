import { describe, expect, it } from 'vitest';
import { createLogger, type RowContext } from './logger.js';
import { frameOf } from './error-row.js';

const capture = (context?: RowContext) => {
  const lines: Record<string, unknown>[] = [];
  const write = (line: string) => void lines.push(JSON.parse(line) as Record<string, unknown>);
  const log = createLogger({
    extension: 'probe',
    part: 'api',
    version: '0.6.0',
    write,
    context: () => context,
  });
  return { log, lines };
};
const levels = (lines: Record<string, unknown>[]) => lines.map((l) => [l['kind'], l['level']]);

describe('createLogger', () => {
  it('writes the request context the kit set, and service outside a request', () => {
    const who = {
      agcid: '0193a1f0a7c27d3e9b1c4f2a8e6d5b01',
      sub: 'usr_7f3a',
      user_type: 'agent' as const,
    };
    const inside = capture({ ...who, session: 'tok_1', client: 'claude-code' });
    inside.log.info('hi', { token: 'secret' });
    expect(inside.lines[0]).toMatchObject({ ...who, session: 'tok_1', client: 'claude-code' });
    expect(inside.lines[0]?.['fields']).toEqual({ token: '[redacted]' });
    const outside = capture();
    outside.log.warn('lonely');
    expect(outside.lines[0]).toMatchObject({
      agcid: null,
      sub: null,
      user_type: 'service',
      kind: 'log',
    });
  });

  it('http: level by status and time, health paths leave no row, the template only', () => {
    const { log, lines } = capture();
    const row = { method: 'GET', route: '/api/v1/machines', ms: 12 };
    log.http({ ...row, status: 200, bytes: 418 });
    log.http({ ...row, status: 401, reason: 'missing_token' });
    log.http({ ...row, status: 200, ms: 1500 });
    log.http({ ...row, status: 500, errorType: 'TypeError' });
    log.http({ ...row, route: '/health', status: 200 });
    expect(levels(lines)).toEqual([
      ['http', 'info'],
      ['http', 'warn'],
      ['http', 'warn'],
      ['http', 'error'],
    ]);
    expect(lines[0]).toMatchObject({ msg: 'GET /api/v1/machines 200' });
    expect(lines[1]?.['fields']).toMatchObject({ 'agentage.auth.reason': 'missing_token' });
    expect(lines[3]?.['fields']).toMatchObject({
      'error.type': 'TypeError',
      'http.response.status_code': 500,
    });
  });

  it('mcp, job, span and event rows, each with its level rule', async () => {
    const { log, lines } = capture();
    log.mcp({ tool: 'probe__echo', ms: 9, results: 1 });
    log.mcp({ tool: 'probe__find', ms: 6000, code: 'ITEM_NOT_FOUND' });
    log.mcp({ tool: 'probe__crash', ms: 2, error: new RangeError('x') });
    log.job({ name: 'retention', runId: 'r1', ms: 310 });
    log.job({ name: 'retention', runId: 'r2', ms: 5, error: new Error('x') });
    await log.span('store.query', () => 1);
    log.event('startup', { 'agentage.startup.commit': 'abc' });
    log.event('backup.run', { 'agentage.backup.status': 'failed' });
    expect(levels(lines)).toEqual([
      ...[
        ['mcp', 'info'],
        ['mcp', 'warn'],
        ['mcp', 'error'],
        ['job', 'info'],
        ['job', 'error'],
      ],
      ...[
        ['span', 'info'],
        ['event', 'info'],
        ['event', 'error'],
      ],
    ]);
    expect(lines[0]?.['fields']).toMatchObject({
      'gen_ai.tool.name': 'probe__echo',
      'agentage.results': 1,
    });
    expect(lines[6]?.['fields']).toMatchObject({ 'event.name': 'startup' });
  });

  it('error: cause, first in-app frame and a fingerprint unless the author gives one', () => {
    const { log, lines } = capture();
    log.error(new Error('outer', { cause: new Error('root') }), '/api/v1/emit');
    log.error(new Error('grouped'), { 'agentage.fingerprint': 'mine' });
    expect(lines[0]?.['fields']).toMatchObject({
      'agentage.cause': 'root',
      'agentage.where': '/api/v1/emit',
      'agentage.fingerprint': expect.stringMatching(/^Error@.*logger\.test\.ts:\d+$/) as unknown,
    });
    expect(lines[1]?.['fields']).toMatchObject({ 'agentage.fingerprint': 'mine' });
    const stack =
      'Error: x\n    at f (node:internal/x:1:1)\n    at g (/app/node_modules/y/i.js:2:3)\n    at h (/app/dist/api/fail.js:4:9)';
    expect(frameOf(stack)).toBe('/app/dist/api/fail.js:4');
  });
});
