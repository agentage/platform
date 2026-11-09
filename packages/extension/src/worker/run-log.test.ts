import { describe, expect, it } from 'vitest';
import { recordedLog } from '../test-support/http.js';
import { append, runLog, withRunBuffer, type RunBuffer } from './run-log.js';

const MARKER = '\n[log truncated at 64 KB]\n';

describe('run log', () => {
  it('keeps newlines and whole lines, never past 64 KB with its one truncation marker', () => {
    const buffer: RunBuffer = { text: '', truncated: false };
    append(buffer, 'first\nsecond');
    expect(buffer.text).toBe('first\nsecond\n');
    const line = 'x'.repeat(1023);
    for (let i = 0; i < 63; i += 1) append(buffer, line);
    expect(buffer.truncated).toBe(false);
    // Fits under 64 KB on its own, but not with the marker that must still follow.
    append(buffer, 'y'.repeat(999));
    append(buffer, 'later');
    expect(buffer.truncated).toBe(true);
    expect(buffer.text).toBe(`first\nsecond\n${`${line}\n`.repeat(63)}${MARKER}`);
    expect(Buffer.byteLength(buffer.text)).toBeLessThanOrEqual(64 * 1024);
  });

  it('counts bytes, not characters', () => {
    const buffer: RunBuffer = { text: '', truncated: false };
    for (let i = 0; i < 40; i += 1) append(buffer, 'é'.repeat(1000));
    expect(buffer.truncated).toBe(true);
    expect(buffer.text).toBe(`${`${'é'.repeat(1000)}\n`.repeat(32)}${MARKER}`);
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
      ['error', 'Error: not an Error'],
      ['error', 'Error: three'],
    ]);
    expect(lines[1]).toMatchObject({ n: 1 });
  });
});
