import * as z from 'zod/mini';
import { type FetchLike } from '../host/host.types.js';

export const DEV_ISSUER = 'http://localhost:4281/token';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const IssuerAnswerSchema = z.object({ token: z.string().check(z.minLength(1)) });
// A dev issuer that hangs costs the page this long, then calls go anonymous.
const ISSUER_TIMEOUT_MS = 5_000;

export interface TokenInput {
  id: string;
  hostname: string;
  token?: string;
  scope?: string;
  fetch: FetchLike;
  warn: (message: string) => void;
}

const fromIssuer = async (input: TokenInput): Promise<string> => {
  const res = await input.fetch(DEV_ISSUER, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: input.scope ?? `${input.id}:read` }),
    signal: AbortSignal.timeout(ISSUER_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`dev issuer answered ${res.status}`);
  const answer = IssuerAnswerSchema.safeParse(await res.json());
  if (!answer.success) throw new Error('dev issuer answered without a token');
  return answer.data.token;
};

// ?token= wins; on a local page the dev issuer of `up` mints ?scope= (default {id}:read).
export const resolveToken = async (input: TokenInput): Promise<string | undefined> => {
  if (input.token) return input.token;
  if (!LOCAL_HOSTS.has(input.hostname)) return undefined;
  try {
    return await fromIssuer(input);
  } catch (error) {
    input.warn(`agentage harness: no dev token (${(error as Error).message}), calling anonymously`);
    return undefined;
  }
};
