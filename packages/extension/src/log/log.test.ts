import { describe, expect, it } from 'vitest';
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
    log.error(new TypeError('boom'), { route: '/x' });
    log.error('plain');
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'boom', route: '/x' });
    expect(lines[0]?.['err']).toMatchObject({ type: 'TypeError', message: 'boom' });
    expect(lines[1]).toMatchObject({ msg: 'plain', err: { message: 'plain' } });
  });
});
