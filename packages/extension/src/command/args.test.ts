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
    expect(() => parse([])).toThrow(new UsageError('missing argument: msg'));
    expect(() => parse(['a', '1', '2', 'extra'])).toThrow('too many arguments: extra');
    expect(() => parse(['a', '1.5'])).toThrow('times must be an integer');
    expect(() => parse(['a', '1', 'x'])).toThrow('ratio must be a number');
    expect(() => parse(['a', '--ratio', 'Infinity'])).toThrow('ratio must be a number');
  });

  it('takes a boolean as a flag only, never positional; absent reads false', () => {
    const flag: CommandSpec = {
      name: 'go',
      summary: 'Go',
      args: [{ name: 'force', type: 'boolean' }],
    };
    expect(parse(['--force'], flag).args).toEqual({ force: true });
    expect(parse([], flag).args).toEqual({ force: false });
    expect(() => parse(['true'], flag)).toThrow('too many arguments: true');
  });

  it('turns an unknown option into a usage error', () => {
    expect(() => parse(['a', '--nope'])).toThrow(UsageError);
    expect(() => parse(['a', '--nope'])).toThrow(/--nope/);
  });

  it('takes a command without args', () => {
    const bare = { name: 'status', summary: 'Shows status' };
    expect(parse([], bare)).toEqual({ args: {}, json: false, help: false });
    expect(() => parse(['x'], bare)).toThrow('too many arguments: x');
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
