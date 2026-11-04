import { parseArgs } from 'node:util';
import { build, type BuildOptions, type BuildResult } from './build.js';
import { buildLines } from './format.js';
import { down, type DownOptions } from './up/down.js';
import { token, type TokenOptions } from './up/token.js';
import { up, type UpOptions } from './up/up.js';

export interface MainDeps {
  build: (options: BuildOptions) => Promise<BuildResult>;
  up: (options: UpOptions) => Promise<unknown>;
  down: (options: DownOptions) => Promise<unknown>;
  token: (options: TokenOptions) => Promise<string>;
  out: (line: string) => void;
  err: (line: string) => void;
}

const USAGE = `usage: agentage-extension <build|up|down|token> [options]

  build      one image per part from the kit recipe
    --push     push the images and write dist/agentage-extension.json with their digests
    --registry image registry and owner (default: ghcr.io/agentage)
  up         the release images on Docker: store, dev issuer, gateway on localhost:4280
  down       remove what up started; --keep-data keeps the store volume
  token      a dev token: --scope <id>:<verb> [--issuer <url>]
  --dir      the extension package folder (default: the current folder)`;

const defaultDeps: MainDeps = {
  build: (options) => build(options),
  up: (options) => up(options),
  down: (options) => down(options),
  token: (options) => token(options),
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
};

const OPTIONS = {
  push: { type: 'boolean' },
  dir: { type: 'string' },
  registry: { type: 'string' },
  'keep-data': { type: 'boolean' },
  scope: { type: 'string' },
  issuer: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const;

const parse = (argv: string[]) =>
  parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });

type Values = ReturnType<typeof parse>['values'];

class UsageError extends Error {}

const COMMANDS: Record<string, (values: Values, deps: MainDeps) => Promise<void>> = {
  build: async (v, deps) => {
    for (const line of buildLines(
      await deps.build({ push: v.push, dir: v.dir, registry: v.registry })
    ))
      deps.out(line);
  },
  up: async (v, deps) => void (await deps.up({ dir: v.dir, onLine: deps.out })),
  down: async (v, deps) =>
    void (await deps.down({ dir: v.dir, keepData: v['keep-data'], onLine: deps.out })),
  token: async (v, deps) => {
    if (!v.scope) throw new UsageError('token needs --scope <id>:<verb>');
    deps.out(await deps.token({ scope: v.scope, issuer: v.issuer }));
  },
};

const runOne = async (name: string, values: Values, deps: MainDeps): Promise<number> => {
  try {
    await COMMANDS[name]?.(values, deps);
    return 0;
  } catch (err) {
    deps.err(
      err instanceof UsageError
        ? `${err.message}\n${USAGE}`
        : `${name} failed: ${(err as Error).message}`
    );
    return err instanceof UsageError ? 2 : 1;
  }
};

// Exit codes: 0 ok, 1 the step failed, 2 usage.
export const main = async (argv: string[], deps: MainDeps = defaultDeps): Promise<number> => {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    deps.err(`${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  const { positionals, values } = parsed;
  if (values.help) {
    deps.out(USAGE);
    return 0;
  }
  const name = positionals[0] ?? '';
  if (!(name in COMMANDS) || positionals.length !== 1) {
    deps.err(USAGE);
    return 2;
  }
  return runOne(name, values, deps);
};
