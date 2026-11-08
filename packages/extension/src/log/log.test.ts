import { describe, expect, it } from 'vitest';
import { agcidMiddleware } from '../agcid/scope.js';
import { createLog, logAt, type Log } from './log.js';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const log = createLog({ extension: 'probe', part: 'api' }, (line) => {
    expect(line.endsWith('\n')).toBe(true);
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { log, lines };
};

describe('log', () => {
  it('writes JSON lines tagged with extension.id and extension.part', () => {
    const { log, lines } = capture();
    log.info('listening', { port: 3000 });
    log.warn('careful');
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'listening',
      'extension.id': 'probe',
      'extension.part': 'api',
      port: 3000,
    });
    expect(lines[1]).toMatchObject({ level: 'warn', msg: 'careful' });
    expect(lines[0]).not.toHaveProperty('agcid');
  });

  it('passes an error whole under err', () => {
    const { log, lines } = capture();
    const error = new TypeError('boom');
    log.error(error, { route: '/x', err: 'not the error' });
    log.error('plain');
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'boom', route: '/x' });
    expect(lines[0]?.['err']).toEqual({ type: 'TypeError', message: 'boom', stack: error.stack });
    expect(lines[1]).toMatchObject({ msg: 'plain', err: { message: 'plain' } });
  });

  it('a field never overwrites time, level, msg or the tags', () => {
    const { log, lines } = capture();
    const tags = { 'extension.id': 'x', 'extension.part': 'x' };
    log.warn('kept', { time: 'x', level: 'debug', msg: 'x', ...tags, n: 1 });
    const kept = { 'extension.id': 'probe', 'extension.part': 'api' };
    expect(lines[0]).toMatchObject({ level: 'warn', msg: 'kept', ...kept });
    expect(lines[0]?.['time']).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(Object.keys(lines[0] ?? {})).toEqual([
      ...['time', 'level', 'msg', 'extension.id', 'extension.part', 'n'],
    ]);
  });

  it('tags a line written inside a request with its agcid', () => {
    const { log, lines } = capture();
    const res = { locals: {}, setHeader: () => undefined };
    const req = { get: () => 'caller-chosen-id' };
    agcidMiddleware(req as never, res as never, () => log.info('in a request'));
    expect(lines[0]).toMatchObject({ msg: 'in a request', agcid: 'caller-chosen-id' });
  });

  it('adds version and base fields after the tags', () => {
    const lines: Record<string, unknown>[] = [];
    const tags = { extension: 'probe', part: 'cli', version: '1.2.3', base: { command: 'sync' } };
    createLog(tags, (l) => void lines.push(JSON.parse(l) as Record<string, unknown>)).info('x');
    expect(Object.keys(lines[0] ?? {})).toEqual([
      ...['time', 'level', 'msg', 'extension.id', 'extension.part', 'version', 'command'],
    ]);
  });

  it('logAt writes an error-level line without err, and falls back on another Log', () => {
    const { log, lines } = capture();
    logAt(log, 'error', 'request', { status: 500 });
    expect(lines[0]).toEqual(expect.not.objectContaining({ err: expect.anything() }));
    const seen: string[] = [];
    const other: Log = {
      info: (m) => void seen.push(`info ${m}`),
      warn: (m) => void seen.push(`warn ${m}`),
      error: (e) => void seen.push(`error ${String(e)}`),
    };
    logAt(other, 'warn', 'a', {});
    logAt(other, 'error', 'b', {});
    expect(seen).toEqual(['warn a', 'error b']);
  });
});
