import { type RouteMethod } from '../api/routes.js';
import { type Caller } from '../auth/token-check.js';
import { type Log } from '../log/log.js';
import { type Out } from './out.js';
import { type ArgValue } from './args.js';

export interface CommandExtension {
  id: string;
  version: string;
  part: 'cli';
}

// The extension's own api and mcp; the host adds the PAT and a fresh agcid, it reaches nothing else.
export interface CliClient {
  // path as the OpenAPI declares it under /api/v1, params filled: api('get', '/items/42').
  api(method: RouteMethod, path: string, input?: unknown): Promise<unknown>;
  // One of its own tools by name: the structuredContent.
  tool(name: string, args?: Record<string, unknown>): Promise<unknown>;
}

// One ctx per command run: who am I, the parsed args, and output that reads like the console.
export interface CliContext {
  readonly extension: Readonly<CommandExtension>;
  readonly args: Readonly<Record<string, ArgValue>>;
  readonly out: Out;
  // JSON lines on stderr tagged with the extension, part cli, the command and the run's agcid.
  readonly log: Log;
  // The machine's signed-in user and its PAT's scopes; null when the host knows none.
  readonly user: Caller | null;
  readonly client: CliClient;
  // The command's own folder for config and cache between runs, owner-only, made on first read.
  readonly dir: string;
}

export type CommandHandler = () => unknown;

export type CliCreate = (ctx: CliContext) => Record<string, CommandHandler>;
