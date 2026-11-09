import { describe, expect, it } from 'vitest';
import { createLogger, type RowContext } from './logger.js';

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

  it('mcp, job, span and event rows, each with its level rule; no deferred fields', async () => {
    const { log, lines } = capture();
    log.mcp({ tool: 'probe__echo', ms: 9 });
    log.mcp({ tool: 'probe__find', ms: 6000 });
    log.mcp({ tool: 'probe__crash', ms: 2, error: new RangeError('x') });
    log.job({ name: 'retention', runId: 'r1', ms: 310 });
    log.job({ name: 'retention', runId: 'r2', ms: 5, error: new Error('x') });
    await log.span('store.query', () => 1);
    log.event('startup', { 'agentage.startup.commit': 'abc' });
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
      ],
    ]);
    expect(lines[0]?.['fields']).toEqual({
      'mcp.method.name': 'tools/call',
      'gen_ai.tool.name': 'probe__echo',
      'agentage.duration_ms': 9,
    });
    expect(lines[2]?.['fields']).toMatchObject({ 'error.type': 'RangeError' });
    expect(lines[6]?.['fields']).toMatchObject({ 'event.name': 'startup' });
  });

  it('error: type, message, stack and where; a fingerprint only when the author gives one', () => {
    const { log, lines } = capture();
    log.error(new Error('outer', { cause: new Error('root') }), '/api/v1/emit');
    log.error(new Error('grouped'), { 'agentage.fingerprint': 'mine' });
    const first = lines[0]?.['fields'] as Record<string, unknown>;
    expect(first).toMatchObject({ 'exception.type': 'Error', 'agentage.where': '/api/v1/emit' });
    expect(Object.keys(first).filter((k) => /cause|frame|fingerprint|code/.test(k))).toEqual([]);
    expect(lines[1]?.['fields']).toMatchObject({ 'agentage.fingerprint': 'mine' });
  });
});
