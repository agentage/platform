import { type Run } from '../exec.js';
import { compose, type ComposeTarget } from './compose-run.js';
import { PART_PORT } from './gateway.js';

// Inside the container: parts publish no host port, and the image always has node.
const FETCH = `fetch('http://127.0.0.1:${PART_PORT}/health').then(async (r) => process.stdout.write(await r.text()))`;

const dataOf = (text: string): Record<string, unknown> | undefined => {
  try {
    return (JSON.parse(text) as { data?: Record<string, unknown> }).data;
  } catch {
    return undefined;
  }
};

// The first of status, commit, part that differs from the build, as one FAIL line.
const mismatch = (part: string, commit: string, text: string): string | undefined => {
  const data = dataOf(text);
  if (!data) return `FAIL ${part} /health body is not the health envelope: ${text.slice(0, 120)}`;
  const want: Record<string, string> = { status: 'ok', commit, part };
  const field = Object.keys(want).find((key) => data[key] !== want[key]);
  return field && `FAIL ${part} /health ${field} ${String(data[field])}, needs ${want[field]}`;
};

// Docker's healthy only says the probe answered; the body must name this build and this part.
export const assertHealthBodies = async (
  run: Run,
  target: ComposeTarget,
  parts: string[],
  commit: string
): Promise<void> => {
  const read = parts.map((part) => compose(run, target, ['exec', '-T', part, 'node', '-e', FETCH]));
  const bodies = await Promise.all(read);
  const failed = parts.flatMap((part, i) => mismatch(part, commit, bodies[i] ?? '') ?? []);
  if (failed.length > 0) throw new Error(failed.join('\n'));
};
