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

const AGCID = '0193a1f27c4e7b2a9f103c5d8e2a4b61';

describe('span', () => {
  it('passes the value through and writes one span row', async () => {
    const { span, lines } = capture();
    expect(await span('sum', () => 1 + 2)).toBe(3);
    expect(lines).toEqual([expect.objectContaining({ kind: 'span', level: 'info' })]);
    expect(lines[0]?.['fields']).toEqual({
      'agentage.span.name': 'sum',
      'agentage.duration_ms': expect.any(Number) as unknown,
    });
  });

  it('passes the throw through and writes the span row at error with error.type', async () => {
    const { span, lines } = capture();
    const boom = new TypeError('boom');
    await expect(span('fetch', async () => Promise.reject(boom))).rejects.toBe(boom);
    expect(lines[0]).toMatchObject({ kind: 'span', level: 'error' });
    expect(lines[0]?.['fields']).toMatchObject({ 'error.type': 'TypeError' });
  });

  it('carries the current agcid, inner and outer alike', async () => {
    const { span, lines } = capture();
    const value = await requestScope.run({ agcid: AGCID }, () =>
      span('outer', () => span('inner', async () => 'x'))
    );
    expect(value).toBe('x');
    const rows = lines.map((line) => line as { agcid: string; fields: Record<string, unknown> });
    expect(rows.map((row) => [row.fields['agentage.span.name'], row.agcid])).toEqual([
      ['inner', AGCID],
      ['outer', AGCID],
    ]);
  });

  it('createTestContext records spans and their rows', async () => {
    const ctx = createTestContext({ store: false });
    const boom = new Error('no');
    await ctx.span('ok', () => 1);
    await expect(ctx.span('bad', () => Promise.reject(boom))).rejects.toBe(boom);
    expect(ctx.spans).toMatchObject([
      { name: 'ok', ok: true },
      { name: 'bad', ok: false, err: boom },
    ]);
    expect(ctx.logs.map((l) => [l.level, l.fields['agentage.span.name']])).toEqual([
      ['info', 'ok'],
      ['error', 'bad'],
    ]);
  });

  it('a command ctx records spans too', async () => {
    const ctx = createTestContext({ args: {} });
    expect(await ctx.span('cmd', () => 'done')).toBe('done');
    expect(ctx.spans).toMatchObject([{ name: 'cmd', ok: true }]);
  });
});
