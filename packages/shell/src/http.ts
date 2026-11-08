import {
  EnvelopeSchema,
  hostError,
  type FetchLike,
  type HostError,
  type TokenSource,
} from '@agentage/widget';

export type ShellError = HostError & { status: number; agcid?: string };

export interface ReadOptions {
  token?: TokenSource;
  fetch?: FetchLike;
}

export interface Call extends ReadOptions {
  method?: string;
  body?: unknown;
  ifMatch?: string;
}

const globalFetch: FetchLike = (url, init) => fetch(url, init);

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');

// Root's error envelope as a typed error; any other failing body is HTTP_<status>.
const shellError = (what: string, status: number, body: unknown): ShellError => {
  const parsed = EnvelopeSchema.safeParse(body);
  const sent = parsed.success && !parsed.data.success ? parsed.data.error : undefined;
  const { code, message, agcid } = sent ?? {
    code: `HTTP_${status}`,
    message: `${what}: HTTP ${status}`,
  };
  const error = Object.assign(hostError(code, message), { name: 'ShellError', status });
  return agcid ? Object.assign(error, { agcid }) : error;
};

const headersOf = async ({ token, ifMatch, body }: Call): Promise<Record<string, string>> => {
  const bearer = await token?.();
  return {
    Accept: 'application/json',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    ...(ifMatch ? { 'If-Match': ifMatch } : {}),
  };
};

export const send = async (url: string, call: Call = {}) => {
  const method = call.method ?? 'GET';
  // Public documents and bearer calls: cookies stay at auth.
  const init: RequestInit = { method, headers: await headersOf(call), credentials: 'omit' };
  if (call.body !== undefined) init.body = JSON.stringify(call.body);
  const res = await (call.fetch ?? globalFetch)(url, init);
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) throw shellError(`${method} ${url}`, res.status, body);
  return { body, etag: res.headers.get('ETag') ?? undefined };
};

export const getJson = async (url: string, fetchFn?: FetchLike): Promise<unknown> =>
  (await send(url, { fetch: fetchFn })).body;
