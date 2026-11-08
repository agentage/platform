import { describe, expect, it } from 'vitest';
import { requestScope } from '../agcid/current.js';
import { createTestContext } from '../context/test-context.js';
import { createLog } from './log.js';
import { createSpan } from './span.js';

const capture = () => {
  const lines: Record<string, unknown>[] = [];
  const log = createLog({ extension: 'probe', part: 'api' }, (line) => {
    lines.push(JSON.parse(line) as Record<string, unknown>);
  });
  return { span: createSpan(log), lines };
};

describe('span', () => {
  it('passes the value through and logs one ok line', async () => {
    const { span, lines } = capture();
    expect(await span('sum', () => 1 + 2)).toBe(3);
    expect(lines).toEqual([expect.objectContaining({ level: 'info', msg: 'span', name: 'sum' })]);
    expect(lines[0]).toMatchObject({ ok: true, ms: expect.any(Number) });
    expect(lines[0]).not.toHaveProperty('err');
  });

  it('passes the throw through and logs ok false with err at error', async () => {
    const { span, lines } = capture();
    const boom = new TypeError('boom');
    await expect(span('fetch', async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(lines[0]).toMatchObject({ level: 'error', msg: 'span', name: 'fetch', ok: false });
    expect(lines[0]?.['err']).toEqual({ type: 'TypeError', message: 'boom', stack: boom.stack });
  });

  it('carries the current agcid, inner and outer alike', async () => {
    const { span, lines } = capture();
    const agcid = 'agcid-0001';
    const value = await requestScope.run({ agcid }, () =>
      span('outer', () => span('inner', async () => 'x'))
    );
    expect(value).toBe('x');
    expect(lines.map((line) => [line['name'], line['agcid']])).toEqual([
      ['inner', agcid],
      ['outer', agcid],
    ]);
  });

  it('createTestContext records spans and their log lines', async () => {
    const ctx = createTestContext({ store: false });
    const boom = new Error('no');
    await ctx.span('ok', () => 1);
    await expect(ctx.span('bad', () => Promise.reject(boom))).rejects.toBe(boom);
    expect(ctx.spans).toMatchObject([
      { name: 'ok', ok: true },
      { name: 'bad', ok: false, err: boom },
    ]);
    expect(ctx.logs.map((l) => [l.level, l.message, l.fields['ok']])).toEqual([
      ['info', 'span', true],
      ['error', 'span', false],
    ]);
  });

  it('a command ctx records spans too', async () => {
    const ctx = createTestContext({ args: {} });
    expect(await ctx.span('cmd', () => 'done')).toBe('done');
    expect(ctx.spans).toMatchObject([{ name: 'cmd', ok: true }]);
  });
});
