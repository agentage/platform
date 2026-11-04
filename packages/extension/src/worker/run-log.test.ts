import { describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { append, LOG_CAP_BYTES, runLog, withRunBuffer, type RunBuffer } from './run-log.js';

const MARKER = '\n[log truncated at 64 KB]\n';

describe('run log', () => {
  it('keeps newlines and caps at 64 KB with one truncation marker', () => {
    const buffer: RunBuffer = { text: '', truncated: false };
    append(buffer, 'first\nsecond');
    expect(buffer.text).toBe('first\nsecond\n');
    const line = 'x'.repeat(1023);
    for (let i = 0; i < 80; i += 1) append(buffer, line);
    expect(buffer.truncated).toBe(true);
    expect(Buffer.byteLength(buffer.text)).toBeLessThanOrEqual(LOG_CAP_BYTES);
    expect(buffer.text.endsWith(MARKER)).toBe(true);
    expect(buffer.text.split(MARKER)).toHaveLength(2);
    const before = buffer.text;
    append(buffer, 'later');
    expect(buffer.text).toBe(before);
  });

  it('counts bytes, not characters', () => {
    const buffer: RunBuffer = { text: '', truncated: false };
    for (let i = 0; i < 40; i += 1) append(buffer, 'é'.repeat(1000));
    expect(buffer.truncated).toBe(true);
    expect(Buffer.byteLength(buffer.text)).toBeLessThanOrEqual(LOG_CAP_BYTES);
  });

  it('writes every line to the base log, and into the run only inside a run', async () => {
    const { log, lines } = recordedLog();
    const ctxLog = runLog(log);
    const buffer: RunBuffer = { text: '', truncated: false };
    ctxLog.info('outside');
    await withRunBuffer(buffer, async () => {
      ctxLog.info('one', { n: 1 });
      ctxLog.warn('two');
      ctxLog.error('not an Error');
      ctxLog.error(new Error('three'));
    });
    expect(buffer.text).toBe('info one\nwarn two\nerror not an Error\nerror three\n');
    expect(lines.map((line) => [line['level'], line['msg']])).toEqual([
      ['info', 'outside'],
      ['info', 'one'],
      ['warn', 'two'],
      ['error', 'not an Error'],
      ['error', 'three'],
    ]);
    expect(lines[1]).toMatchObject({ n: 1 });
  });
});
