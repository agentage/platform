import { type Run } from '../exec.js';
import { compose, type ComposeTarget } from './compose-run.js';
import { PART_PORT } from './gateway.js';

// Inside the container: parts publish no host port, and the image always has node.
const FETCH = `fetch('http://127.0.0.1:${PART_PORT}/health').then(async (r) => process.stdout.write(await r.text()))`;

type Data = Record<string, unknown>;

const dataOf = (text: string): Data | undefined => {
  try {
    return (JSON.parse(text) as { data?: Data }).data;
  } catch {
    return undefined;
  }
};

type Want = [field: string, fits: (value: unknown) => boolean, needs: string];

// 200 ok or degraded is an answering part (the /health standard); only unavailable fails.
const wants = (part: string, commit: string): Want[] => [
  ['status', (v) => v === 'ok' || v === 'degraded', 'ok or degraded'],
  ['commit', (v) => v === commit, commit],
  ['part', (v) => v === part, part],
];

// The first field that differs from the build, as one FAIL line.
const mismatch = (part: string, commit: string, data: Data | undefined, text: string) => {
  if (!data) return `FAIL ${part} /health body is not the health envelope: ${text.slice(0, 120)}`;
  const bad = wants(part, commit).find(([field, fits]) => !fits(data[field]));
  return bad && `FAIL ${part} /health ${bad[0]} ${String(data[bad[0]])}, needs ${bad[2]}`;
};

const notOk = (data: Data): string =>
  Object.entries(Object(data['checks']) as Data)
    .filter(([, status]) => status !== 'ok')
    .map(([name, status]) => `${name} ${String(status)}`)
    .join(' · ');

// A part that gives no answer is its own FAIL line: the exit code and the command's last line.
const noAnswer = (err: Error): string => {
  const code = /exit code (\d+)/.exec(err.message)?.[1];
  return `no answer${code ? ` (exit ${code})` : ''}: ${err.message.split('\n').at(-1) ?? ''}`;
};

// Docker's healthy only says the probe answered; the body must name this build and this part.
export const assertHealthBodies = async (
  run: Run,
  target: ComposeTarget,
  parts: string[],
  commit: string
): Promise<[part: string, checks: string][]> => {
  const exec = (part: string) => compose(run, target, ['exec', '-T', part, 'node', '-e', FETCH]);
  const read = parts.map((part) => exec(part).catch(noAnswer));
  const bodies = await Promise.all(read);
  const data = bodies.map(dataOf);
  const failed = parts.flatMap((part, i) => mismatch(part, commit, data[i], bodies[i] ?? '') ?? []);
  if (failed.length > 0) throw new Error(failed.join('\n'));
  return parts.flatMap((part, i) =>
    data[i]?.['status'] === 'degraded' ? [[part, notOk(data[i])]] : []
  );
};
