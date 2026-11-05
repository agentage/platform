import { loadCreate } from '../manifest/entry.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { readManifest } from '../manifest/read-manifest.js';
import { parseCommandArgs, usage, UsageError } from './args.js';
import { type CliContext, type CommandHandler } from './command.types.js';
import { createOut, type Write } from './out.js';

export interface RunCommandOptions {
  dir: string;
  command: string;
  argv: string[];
  stdout?: Write;
  stderr?: Write;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const writeOut: Write = (text) => void process.stdout.write(text);
const writeErr: Write = (text) => void process.stderr.write(text);

export const loadHandlers = async (dir: string, pkg: ExtensionPackage, ctx: CliContext) =>
  (await loadCreate<CliContext>(dir, pkg, 'cli'))(ctx) as Record<string, CommandHandler>;

export const contextFor = (
  pkg: ExtensionPackage,
  args: CliContext['args'],
  out: CliContext['out']
): CliContext => ({
  extension: Object.freeze({ id: pkg.agentage.id, version: pkg.version, part: 'cli' as const }),
  args: Object.freeze(args),
  out,
});

const execute = async (
  o: RunCommandOptions,
  pkg: ExtensionPackage,
  stdout: Write,
  stderr: Write
) => {
  const spec = pkg.agentage.commands?.find((command) => command.name === o.command);
  if (!spec) throw new UsageError(`${pkg.agentage.id} has no command ${o.command}`);
  const parsed = parseCommandArgs(spec, o.argv);
  if (parsed.help) return (stdout(`${usage(spec)}\n`), EXIT_OK);
  const out = createOut({ json: parsed.json, stdout, stderr });
  const handler = (await loadHandlers(o.dir, pkg, contextFor(pkg, parsed.args, out)))[o.command];
  if (typeof handler !== 'function')
    throw new Error(`the cli entry has no handler for ${o.command}`);
  const result = await handler();
  return out.exitCode ?? (typeof result === 'number' ? result : EXIT_OK);
};

// Exit codes: 0 ok, 2 usage, 1 failure (a throw, a missing handler, an invalid manifest).
export const runCommand = async (o: RunCommandOptions): Promise<number> => {
  const stdout = o.stdout ?? writeOut;
  const stderr = o.stderr ?? writeErr;
  try {
    return await execute(o, await readManifest(o.dir), stdout, stderr);
  } catch (err) {
    stderr(`${(err as Error).message}\n`);
    return err instanceof UsageError ? EXIT_USAGE : EXIT_FAILED;
  }
};
