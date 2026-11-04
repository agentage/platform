import { describe, expect, it } from 'vitest';
import { createOut, tableLines } from './out.js';

const capture = (json: boolean) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = createOut({
    json,
    stdout: (t) => void stdout.push(t),
    stderr: (t) => void stderr.push(t),
  });
  return { out, stdout, stderr };
};

describe('out', () => {
  it('reads like the console: log to stdout, warn and error to stderr, format specifiers', () => {
    const { out, stdout, stderr } = capture(false);
    out.log('pong %s', 'hi', 2);
    out.log({ a: 1 });
    out.warn('careful');
    out.error('bad %d', 7);
    expect(stdout).toEqual(['pong hi 2\n', '{ a: 1 }\n']);
    expect(stderr).toEqual(['careful\n', 'bad 7\n']);
    expect(out.exitCode).toBeUndefined();
  });

  it('under --json routes only out.json to stdout', () => {
    const { out, stdout, stderr } = capture(true);
    out.log('progress');
    out.table([{ a: 1 }]);
    out.json({ ok: true });
    expect(stdout).toEqual(['{\n  "ok": true\n}\n']);
    expect(stderr).toEqual(['progress\n', 'a\n1\n']);
  });

  it('fail sets the exit code and writes the message to stderr', () => {
    const { out, stdout, stderr } = capture(false);
    out.fail(4, 'not found');
    expect(out.exitCode).toBe(4);
    expect(stderr).toEqual(['not found\n']);
    expect(stdout).toEqual([]);
  });

  it('prints a table padded to the widest cell, with every key as a column', () => {
    const { out, stdout } = capture(false);
    out.table([
      { name: 'tick', runs: 12 },
      { name: 'cleanup-long', ok: true },
    ]);
    expect(stdout).toEqual([
      'name          runs  ok\ntick          12\ncleanup-long        true\n',
    ]);
    expect(tableLines([])).toEqual(['']);
  });
});
