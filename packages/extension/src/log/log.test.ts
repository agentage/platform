import { describe, expect, it } from 'vitest';
import { agcidMiddleware } from '../agcid/scope.js';
import { createLog } from './log.js';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const log = createLog({ extension: 'probe', part: 'api' }, (line) => {
    expect(line.endsWith('\n')).toBe(true);
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { log, lines };
};

describe('log', () => {
  it('writes JSON lines tagged with extension and part', () => {
    const { log, lines } = capture();
    log.info('listening', { port: 3000 });
    log.warn('careful');
    expect(lines[0]).toMatchObject({
      level: 'info',
      msg: 'listening',
      extension: 'probe',
      part: 'api',
      port: 3000,
    });
    expect(lines[1]).toMatchObject({ level: 'warn', msg: 'careful' });
    expect(lines[0]).not.toHaveProperty('agcid');
  });

  it('passes an error whole under err', () => {
    const { log, lines } = capture();
    log.error(new TypeError('boom'), { route: '/x', err: 'not the error' });
    log.error('plain');
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'boom', route: '/x' });
    expect(lines[0]?.['err']).toMatchObject({ type: 'TypeError', message: 'boom' });
    expect(lines[0]?.['err']).toHaveProperty('stack');
    expect(lines[1]).toMatchObject({ msg: 'plain', err: { message: 'plain' } });
  });

  it('a field never overwrites time, level, msg or the tags', () => {
    const { log, lines } = capture();
    const fields = { time: 'x', level: 'debug', msg: 'x', extension: 'x', part: 'x', n: 1 };
    log.warn('kept', fields);
    expect(lines[0]).toMatchObject({ level: 'warn', msg: 'kept', extension: 'probe', part: 'api' });
    expect(lines[0]?.['time']).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(Object.keys(lines[0] ?? {})).toEqual(['time', 'level', 'msg', 'extension', 'part', 'n']);
  });

  it('tags a line written inside a request with its agcid', () => {
    const { log, lines } = capture();
    const res = { locals: {}, setHeader: () => undefined };
    const req = { get: () => 'caller-chosen-id' };
    agcidMiddleware(req as never, res as never, () => log.info('in a request'));
    expect(lines[0]).toMatchObject({ msg: 'in a request', agcid: 'caller-chosen-id' });
  });
});
