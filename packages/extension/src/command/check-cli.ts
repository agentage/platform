import { readManifest } from '../manifest/read-manifest.js';
import { loadHandlers } from './run-command.js';
import { createOut } from './out.js';

const quiet = (): void => undefined;

// null when the cli entry exports create and its handlers are exactly the declared commands.
export const checkCli = async (dir: string): Promise<string | null> => {
  try {
    const pkg = await readManifest(dir);
    const declared = (pkg.agentage.commands ?? []).map((command) => command.name).sort();
    const out = createOut({ json: false, stdout: quiet, stderr: quiet });
    const ctx = {
      extension: { id: pkg.agentage.id, version: pkg.version, part: 'cli' as const },
      args: {},
      out,
    };
    const handlers = Object.keys(await loadHandlers(dir, pkg, ctx)).sort();
    if (JSON.stringify(handlers) === JSON.stringify(declared)) return null;
    return `cli handlers [${handlers.join(', ')}] differ from commands [${declared.join(', ')}]`;
  } catch (err) {
    return (err as Error).message;
  }
};
