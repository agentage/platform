import { parseArgs, type ParseArgsConfig } from 'node:util';
import { type CommandSpec } from '../manifest/manifest.schema.js';

export type ArgValue = string | number | boolean | undefined;

export interface ParsedArgs {
  args: Record<string, ArgValue>;
  json: boolean;
  help: boolean;
}

type ArgSpec = NonNullable<CommandSpec['args']>[number];

export class UsageError extends Error {}

export const isOptional = (arg: ArgSpec): boolean =>
  arg.optional === true || arg.required === false;

const coerce = (arg: ArgSpec, raw: string | boolean): ArgValue => {
  if (arg.type === 'boolean') return raw === true || raw === 'true';
  if (arg.type === 'string') return String(raw);
  const value = Number(raw);
  const ok = arg.type === 'integer' ? Number.isInteger(value) : Number.isFinite(value);
  if (raw === true || !ok)
    throw new UsageError(
      `${arg.name} must be ${arg.type === 'integer' ? 'an integer' : 'a number'}`
    );
  return value;
};

const config = (spec: CommandSpec, argv: string[]): ParseArgsConfig => {
  const options: NonNullable<ParseArgsConfig['options']> = {
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  };
  for (const arg of spec.args ?? [])
    options[arg.name] = { type: arg.type === 'boolean' ? 'boolean' : 'string' };
  return { args: argv, options, allowPositionals: true, strict: true };
};

const parse = (spec: CommandSpec, argv: string[]) => {
  try {
    return parseArgs(config(spec, argv));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
};

// Declared args come positional in order or as --name value; --json and --help belong to the kit.
export const parseCommandArgs = (spec: CommandSpec, argv: string[]): ParsedArgs => {
  const { values, positionals } = parse(spec, argv);
  const queue = [...positionals];
  const args: Record<string, ArgValue> = {};
  for (const arg of spec.args ?? []) {
    // A boolean is a flag: absent reads false, so it is never a missing argument.
    const raw = values[arg.name] ?? (arg.type === 'boolean' ? false : queue.shift());
    if (raw === undefined && !isOptional(arg))
      throw new UsageError(`missing argument: ${arg.name}`);
    args[arg.name] = raw === undefined ? undefined : coerce(arg, raw as string | boolean);
  }
  if (queue.length > 0) throw new UsageError(`too many arguments: ${queue.join(' ')}`);
  return { args, json: values['json'] === true, help: values['help'] === true };
};

export const usage = (spec: CommandSpec): string => {
  const names = (spec.args ?? []).map((a) => (isOptional(a) ? `[${a.name}]` : `<${a.name}>`));
  const lines = [
    `usage: agentage ${[spec.name, ...names].join(' ')} [--json]`,
    '',
    `  ${spec.summary}`,
  ];
  for (const arg of spec.args ?? [])
    lines.push(
      `  ${arg.name.padEnd(12)}${arg.type}${arg.description ? `  ${arg.description}` : ''}`
    );
  return lines.join('\n');
};
