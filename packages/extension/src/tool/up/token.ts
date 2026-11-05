import { z } from 'zod';
import { TIMEOUTS } from '../timeouts.js';
import { DEV_ISSUER } from './dev-issuer-app.js';

export interface TokenOptions {
  scope: string;
  issuer?: string;
  fetch?: typeof fetch;
}

const AnswerSchema = z.object({ token: z.string().startsWith('aga_') });

// A token from the dev issuer of `up`, for calling /api/v1/ and /mcp by hand or from tests.
export const token = async (options: TokenOptions): Promise<string> => {
  const issuer = options.issuer ?? DEV_ISSUER;
  const res = await (options.fetch ?? fetch)(`${issuer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scope: options.scope }),
    signal: AbortSignal.timeout(TIMEOUTS.issuer),
  }).catch((err: unknown) => {
    if ((err as Error).name === 'TimeoutError')
      throw new Error(`the dev issuer at ${issuer} did not answer in ${TIMEOUTS.issuer / 1000} s`);
    throw new Error(`no dev issuer at ${issuer}: run agentage extension up first`);
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`the dev issuer refused: ${JSON.stringify(body)}`);
  const answer = AnswerSchema.safeParse(body);
  if (!answer.success) throw new Error('the dev issuer answered without an aga_ token');
  return answer.data.token;
};
