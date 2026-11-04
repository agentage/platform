import { type Out } from './out.js';
import { type ArgValue } from './args.js';

export interface CommandExtension {
  id: string;
  version: string;
  part: 'cli';
}

// One ctx per command run: who am I, the parsed args, and output that reads like the console.
export interface CliContext {
  readonly extension: Readonly<CommandExtension>;
  readonly args: Readonly<Record<string, ArgValue>>;
  readonly out: Out;
}

export type CommandHandler = () => unknown;

export type CliCreate = (ctx: CliContext) => Record<string, CommandHandler>;
