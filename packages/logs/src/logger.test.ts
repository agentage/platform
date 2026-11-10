import { describe, expect, it, vi } from 'vitest';
import { createLogger, MAX_LINE_BYTES, type RowContext } from './logger.js';

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

  it('never throws into the caller: circular, bigint, a throwing getter, huge, a failing write', () => {
    const { log, lines } = capture();
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    const getter = Object.defineProperty({}, 'boom', {
      enumerable: true,
      get: () => {
        throw new Error('getter');
      },
    });
    log.info('circular', circular);
    log.info('bigint', { n: 10n });
    log.info('getter', getter);
    log.error(Object.create(null));
    log.info('huge', { list: Array(1000).fill('y'.repeat(200)) });
    expect(lines.map((l) => l['msg'])).toEqual([
      'circular',
      'bigint',
      'getter',
      'Error: [unprintable]',
      'huge',
    ]);
    expect(lines[0]?.['fields']).toEqual({ a: 1, self: { a: 1, self: { a: 1, self: '[depth]' } } });
    expect([lines[1]?.['fields'], lines[2]?.['fields']]).toEqual([
      { n: '10' },
      { boom: '[unreadable]' },
    ]);
    expect(lines[4]?.['fields']).toEqual({ 'agentage.dropped': 'fields over 64 KB' });
    expect(JSON.stringify(lines[4]).length).toBeLessThan(MAX_LINE_BYTES);
    const failing = createLogger({
      extension: 'x',
      part: 'y',
      write: () => {
        throw new Error('EPIPE');
      },
    });
    expect(() => failing.info('lost')).not.toThrow();
    expect(() =>
      failing.http({ method: 'GET', route: undefined as never, status: 200, ms: 1 })
    ).not.toThrow();
  });

  it('a closed stderr (EPIPE) never crashes the part', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const before = process.stderr.listenerCount('error');
    createLogger({ extension: 'x', part: 'y' }).info('first');
    expect(process.stderr.listenerCount('error')).toBe(before + 1);
    const epipe = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
    expect(() => process.stderr.emit('error', epipe)).not.toThrow();
    write.mockImplementation(() => {
      throw new Error('ERR_STREAM_DESTROYED');
    });
    expect(() => createLogger({ extension: 'x', part: 'y' }).warn('second')).not.toThrow();
    write.mockRestore();
  });

  it('masks credential values in msg, exception.message, the stack and innocent fields', () => {
    const jwt = `eyJhbGciOiJSUzI1NiJ9.${'p'.repeat(40)}.${'s'.repeat(40)}`;
    const { log, lines } = capture();
    log.info(`call failed with Bearer ${jwt}`, {
      note: `aga_${jwt}`,
      header: `bearer ${'z'.repeat(40)}`,
    });
    log.error(new Error(`refused ${jwt}`));
    log.info(`${'m'.repeat(180)} ${jwt}`);
    const text = JSON.stringify(lines);
    expect(text).not.toMatch(/eyJ|aga_|zzzz/);
    expect(lines[0]).toMatchObject({
      msg: 'call failed with [redacted]',
      fields: { note: '[redacted]', header: '[redacted]' },
    });
    expect(lines[1]?.['fields']).toMatchObject({ 'exception.message': 'refused [redacted]' });
    expect(String(lines[2]?.['msg'])).toHaveLength(191);
  });

  it('cuts msg at 200 and bounds the header columns, without control characters', () => {
    const { log, lines } = capture({
      client: `ob\nsid\u0000ian${'x'.repeat(10_000)}`,
      session: 's'.repeat(10_000),
      sub: '\u0007',
    });
    log.info('m'.repeat(5000));
    expect(String(lines[0]?.['msg'])).toHaveLength(200);
    expect(lines[0]?.['client']).toBe(`obsidian${'x'.repeat(56)}`);
    expect(String(lines[0]?.['session'])).toHaveLength(128);
    expect(lines[0]?.['sub']).toBeNull();
  });

  it('a strict log rethrows a failed row; an error with throwing getters still writes its row', () => {
    const sink = () => {
      throw new Error('assertion in a sink');
    };
    expect(() => createLogger({ extension: 'x', part: 'y', sink }).info('a')).not.toThrow();
    const strict = createLogger({ extension: 'x', part: 'y', sink, strict: true });
    expect(() => strict.info('a')).toThrow(/assertion in a sink/);
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'message', {
      get: () => {
        throw new Error('getter');
      },
    });
    const { log, lines } = capture();
    log.error(hostile);
    log.info(`${'m'.repeat(199)}\u{1F600}`);
    expect(lines[0]?.['fields']).toMatchObject({ 'exception.message': '[unreadable]' });
    expect(String(lines[1]?.['msg']).isWellFormed()).toBe(true);
  });
});
