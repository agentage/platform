import { parseArgs } from 'node:util';
import { UsageError } from '../command/args.js';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE } from '../command/run-command.js';
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
  build,
  up,
  down,
  token,
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
    return EXIT_OK;
  } catch (err) {
    const usage = err instanceof UsageError;
    deps.err(usage ? `${err.message}\n${USAGE}` : `${name} failed: ${(err as Error).message}`);
    return usage ? EXIT_USAGE : EXIT_FAILED;
  }
};

const parsedOrUsage = (argv: string[], deps: MainDeps) => {
  try {
    return parse(argv);
  } catch (err) {
    deps.err(`${(err as Error).message}\n${USAGE}`);
    return null;
  }
};

// Exit codes: 0 ok, 1 the step failed, 2 usage.
export const main = async (argv: string[], deps: MainDeps = defaultDeps): Promise<number> => {
  const parsed = parsedOrUsage(argv, deps);
  if (!parsed) return EXIT_USAGE;
  const { positionals, values } = parsed;
  if (values.help) return (deps.out(USAGE), EXIT_OK);
  const name = positionals[0] ?? '';
  if (!(name in COMMANDS) || positionals.length !== 1) return (deps.err(USAGE), EXIT_USAGE);
  return runOne(name, values, deps);
};
