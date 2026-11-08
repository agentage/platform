import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Caller } from '../auth/token-check.js';
import { createLog } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type CliClient, type CliContext } from './command.types.js';
import { type Out, type Write } from './out.js';

// What the host knows about this run; user, client and dataDir only when it has them.
export interface CommandRun {
  command: string;
  args: CliContext['args'];
  out: Out;
  stderr: Write;
  user?: Caller | null;
  client?: CliClient;
  dataDir?: string;
}

const unwired = (): Promise<never> =>
  Promise.reject(new Error('ctx.client: this host does not provide a client yet'));

export const NO_CLIENT: CliClient = Object.freeze({ api: unwired, tool: unwired });

// Owner-only, made on first read, so --help and the build check never create a folder.
const ownDir = (dataDir: string | undefined, id: string) => (): string => {
  if (dataDir === undefined) throw new Error('ctx.dir: this host passes no data dir');
  const dir = join(dataDir, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
};

export const cliContext = (pkg: ExtensionPackage, run: CommandRun): CliContext => {
  const { id } = pkg.agentage;
  const tags = { extension: id, part: 'cli', version: pkg.version, base: { command: run.command } };
  const dir = ownDir(run.dataDir, id);
  return Object.freeze({
    extension: Object.freeze({ id, version: pkg.version, part: 'cli' as const }),
    args: Object.freeze(run.args),
    out: run.out,
    log: createLog(tags, run.stderr),
    user: run.user ?? null,
    client: run.client ?? NO_CLIENT,
    get dir() {
      return dir();
    },
  });
};
