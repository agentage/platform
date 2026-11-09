import { describe, expect, it } from 'vitest';
import { EventSchema, KINDS } from './event.schema.js';
import { parseLine } from './parse-line.js';
import { redact } from './redact.js';
import { uuidv7 } from './uuidv7.js';

const AGCID = '0193a1f0a7c27d3e9b1c4f2a8e6d5b01';
const base = {
  ts: '2026-11-10T09:12:03.412Z',
  level: 'info',
  msg: 'x',
  extension: 'probe',
  part: 'api',
};
const SAMPLES: Record<string, Record<string, unknown>> = {
  http: {
    'http.request.method': 'GET',
    'http.route': '/api/v1/machines',
    'http.response.status_code': 401,
  },
  mcp: {
    'mcp.method.name': 'tools/call',
    'gen_ai.tool.name': 'probe__echo',
    'agentage.results': 1,
  },
  job: {
    'agentage.job.name': 'retention',
    'agentage.job.run_id': '42',
    'agentage.duration_ms': 310,
  },
  span: { 'agentage.span.name': 'store.query', 'agentage.duration_ms': 4 },
  error: { 'exception.type': 'Error', 'exception.message': 'forced' },
  event: { 'event.name': 'host.stats', 'agentage.host.cpu_pct': 12.4 },
  log: { 'agentage.raw': true },
};

describe('EventSchema (C2)', () => {
  it.each(KINDS)('takes a %s row and fills the defaults', (kind) => {
    const event = EventSchema.parse({ ...base, kind, agcid: AGCID, fields: SAMPLES[kind] });
    expect(event).toMatchObject({
      kind,
      agcid: AGCID,
      sub: null,
      user_type: 'service',
      version: '',
    });
    expect(event.fields).toEqual(SAMPLES[kind]);
  });

  it('refuses a row with an unknown kind, a bad level, a dashed agcid or no extension', () => {
    const bad = [
      { ...base, kind: 'metric' },
      { ...base, kind: 'log', level: 'debug' },
      { ...base, kind: 'log', agcid: '0193a1f0-a7c2-7d3e-9b1c-4f2a8e6d5b01' },
      { ...base, kind: 'log', extension: '' },
    ];
    expect(bad.map((row) => EventSchema.safeParse(row).success)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('parseLine', () => {
  it('reads a kit line as its event', () => {
    const line = JSON.stringify({ ...base, kind: 'span', agcid: AGCID, fields: SAMPLES['span'] });
    expect(parseLine(line)).toMatchObject({ kind: 'span', agcid: AGCID });
  });

  it('keeps any other line whole as a raw log row, error when it says ERROR or FATAL', () => {
    const raw = parseLine('LOG:  checkpoint complete', { extension: 'platform', part: 'store' });
    expect(raw).toMatchObject({ kind: 'log', level: 'info', agcid: null, extension: 'platform' });
    expect(raw).toMatchObject({
      msg: 'LOG:  checkpoint complete',
      fields: { 'agentage.raw': true },
    });
    expect(parseLine('FATAL: the database system is shutting down').level).toBe('error');
    expect(parseLine('{"old":"kit line"}')).toMatchObject({ kind: 'log', part: 'unknown' });
  });
});

describe('redact', () => {
  it('masks credential keys, cuts strings at 200 and nesting at depth 3', () => {
    const out = redact({
      authorization: 'Bearer abc',
      'agentage.api_key': 'k',
      nested: { password: 'p', deep: { deeper: { deepest: 1 } } },
      long: 'x'.repeat(300),
      'exception.stacktrace': 's'.repeat(300),
    });
    expect(out).toMatchObject({ authorization: '[redacted]', 'agentage.api_key': '[redacted]' });
    expect(out['nested']).toEqual({ password: '[redacted]', deep: { deeper: '[depth]' } });
    expect([String(out['long']).length, String(out['exception.stacktrace']).length]).toEqual([
      200, 300,
    ]);
  });
});

describe('uuidv7', () => {
  it('is 32 hex with the time in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 9);
    const id = uuidv7(now);
    expect(id).toMatch(/^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/);
    expect(parseInt(id.slice(0, 12), 16)).toBe(now);
  });
});
