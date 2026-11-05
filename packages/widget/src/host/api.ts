import { hostError } from './host-error.js';
import { type FetchLike, type TokenSource } from './host.types.js';
import { EnvelopeSchema } from './rpc.schema.js';
import { timedOut, withTimeout } from './timeout.js';

const withAuth = (init: RequestInit | undefined, token: string | undefined): RequestInit => {
  const headers = new Headers(init?.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
};

const readJson = async (res: Response): Promise<unknown> => {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
};

export const callApi = async (
  fetchFn: FetchLike,
  token: TokenSource,
  path: string,
  init?: RequestInit
): Promise<unknown> => {
  if (!path.startsWith('/')) throw hostError('BAD_PATH', `api path must start with /: ${path}`);
  const { res, body } = await fetchFn(`/api/v1${path}`, withTimeout(withAuth(init, await token())))
    .then(async (answer) => ({ res: answer, body: await readJson(answer) }))
    .catch(timedOut(`/api/v1${path}`));
  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) throw hostError(`HTTP_${res.status}`, `api answered ${res.status}`);
  if (!envelope.data.success)
    throw hostError(envelope.data.error.code, envelope.data.error.message);
  return envelope.data.data;
};
