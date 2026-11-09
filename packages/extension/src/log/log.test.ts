import { describe, expect, it } from 'vitest';
import { agcidMiddleware } from '../agcid/scope.js';
import { createLog } from './log.js';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const log = createLog({ extension: 'probe', part: 'api', version: '0.6.0' }, (line) => {
    expect(line.endsWith('\n')).toBe(true);
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { log, lines };
};

const AGCID = '825f5fe46cf881ced6bd9a89f6be790b';

const inRequest = (headers: Record<string, string>, fn: () => void) => {
  const res = { locals: {}, setHeader: () => undefined };
  const req = { get: (name: string) => headers[name], path: '/api/v1/x' };
  agcidMiddleware(req as never, res as never, fn);
};

describe('log', () => {
  it('writes the event line: the 13 columns in order, author fields inside fields', () => {
    const { log, lines } = capture();
    log.info('listening', { port: 3000 });
    expect(Object.keys(lines[0] ?? {})).toEqual([
      ...['ts', 'level', 'kind', 'msg', 'extension', 'part', 'version'],
      ...['agcid', 'sub', 'session', 'user_type', 'client', 'fields'],
    ]);
    expect(lines[0]).toMatchObject({
      ...{ level: 'info', kind: 'log', msg: 'listening', extension: 'probe', part: 'api' },
      ...{ agcid: null, sub: null, user_type: 'service', fields: { port: 3000 } },
    });
  });

  it('writes an error row with type, message, stack, where and ', () => {
    const { log, lines } = capture();
    log.error(new TypeError('boom'), '/api/v1/x');
    log.error('plain', { job: 'tick' });
    expect(lines[0]).toMatchObject({ level: 'error', kind: 'error', msg: 'TypeError: boom' });
    expect(lines[0]?.['fields']).toMatchObject({
      ...{ 'exception.type': 'TypeError', 'exception.message': 'boom' },
      'agentage.where': '/api/v1/x',
    });
    expect(lines[1]).toMatchObject({ msg: 'Error: plain', fields: { job: 'tick' } });
  });

  it('takes agcid, session, user_type and client from the request it runs in', () => {
    const { log, lines } = capture();
    const headers = { agcid: AGCID, agsid: 'sit_1', 'user-agent': 'curl/8.5.0' };
    inRequest(headers, () => log.info('in a request'));
    expect(lines[0]).toMatchObject({
      ...{ agcid: AGCID, session: 'sit_1', sub: null },
      ...{ user_type: 'automation', client: 'curl' },
    });
  });

  it('adds base fields under fields; log.event writes an event row', () => {
    const lines: Record<string, unknown>[] = [];
    const tags = { extension: 'probe', part: 'cli', version: '1.2.3', base: { command: 'sync' } };
    const log = createLog(tags, (l) => void lines.push(JSON.parse(l) as Record<string, unknown>));
    log.info('x');
    log.event('probe.emitted', { 'agentage.probe.n': 1 }, 'probe emitted');
    expect(lines[0]).toMatchObject({ kind: 'log', fields: { command: 'sync' } });
    expect(lines[1]).toMatchObject({ kind: 'event', level: 'info', msg: 'probe emitted' });
  });
});
