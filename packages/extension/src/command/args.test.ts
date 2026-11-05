import { describe, expect, it } from 'vitest';
import { type CommandSpec } from '../manifest/manifest.schema.js';
import { parseCommandArgs, usage, UsageError } from './args.js';

const SPEC: CommandSpec = {
  name: 'ping',
  summary: 'Answers pong',
  args: [
    { name: 'msg', type: 'string', description: 'what to echo' },
    { name: 'times', type: 'integer', optional: true },
    { name: 'ratio', type: 'number', required: false },
    { name: 'loud', type: 'boolean', optional: true },
  ],
};

const parse = (argv: string[], spec: CommandSpec = SPEC) => parseCommandArgs(spec, argv);

// The message of the UsageError (exit 2) a refused argv throws.
const refusal = (argv: string[], spec: CommandSpec = SPEC): string => {
  try {
    parse(argv, spec);
    return 'parsed';
  } catch (err) {
    return err instanceof UsageError ? err.message : `not a UsageError: ${String(err)}`;
  }
};

describe('parseCommandArgs', () => {
  it('takes declared args positional in order or as --name value, typed', () => {
    expect(parse(['hi', '3', '0.5'])).toEqual({
      args: { msg: 'hi', times: 3, ratio: 0.5, loud: false },
      json: false,
      help: false,
    });
    expect(parse(['--times', '2', '--msg', 'yo', '--loud', '--json']).args).toEqual({
      msg: 'yo',
      times: 2,
      ratio: undefined,
      loud: true,
    });
    expect(parse(['hi', '--json', '-h'])).toMatchObject({ json: true, help: true });
  });

  it('refuses a missing required arg, too many args and wrong types', () => {
    expect(refusal([])).toBe('missing argument: msg');
    expect(refusal(['a', '1', '2', 'extra'])).toBe('too many arguments: extra');
    expect(refusal(['a', '1.5'])).toBe('times must be an integer');
    expect(refusal(['a', '1', 'x'])).toBe('ratio must be a number');
    expect(refusal(['a', '--ratio', 'Infinity'])).toBe('ratio must be a number');
    expect(refusal(['a', '--times'])).toMatch(/^Option '--times <value>' argument missing/);
  });

  it('takes a boolean as a flag only, never positional; absent reads false', () => {
    const flag: CommandSpec = {
      name: 'go',
      summary: 'Go',
      args: [{ name: 'force', type: 'boolean' }],
    };
    expect(parse(['--force'], flag).args).toEqual({ force: true });
    expect(parse([], flag).args).toEqual({ force: false });
    expect(refusal(['true'], flag)).toBe('too many arguments: true');
  });

  it('turns an unknown option into a usage error', () => {
    expect(refusal(['a', '--nope'])).toMatch(/^Unknown option '--nope'/);
  });

  it('takes a command without args', () => {
    const bare = { name: 'status', summary: 'Shows status' };
    expect(parse([], bare)).toEqual({ args: {}, json: false, help: false });
    expect(refusal(['x'], bare)).toBe('too many arguments: x');
  });
});

describe('usage', () => {
  it('names required args in angles and optional ones in brackets', () => {
    expect(usage(SPEC).split('\n')).toEqual([
      'usage: agentage ping <msg> [times] [ratio] [loud] [--json]',
      '',
      '  Answers pong',
      '  msg         string  what to echo',
      '  times       integer',
      '  ratio       number',
      '  loud        boolean',
    ]);
  });
});
