import * as z from 'zod/mini';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type IdentityError = Error & { code: string; status: number };

const fail = ({ code, message }: { code: string; message: string }, status = 0): IdentityError =>
  Object.assign(new Error(message), { name: 'IdentityError', code, status });
const unreachable = (path: string) => () =>
  Promise.reject(fail({ code: 'NETWORK', message: `auth unreachable: ${path}` }));

const ok = <T extends z.ZodMiniType>(data: T) => z.object({ success: z.literal(true), data });
const str = z.string();
const Failed = z.object({ error: z.object({ code: str, message: str }) });
const User = z.object({ id: str, email: str, name: z.optional(z.nullable(str)) });
const Minted = ok(z.object({ id: str, token: str, expiresAt: str }));
const Times = { createdAt: z.nullable(str), expiresAt: z.nullable(str) };
const Revoked = ok(z.object({ revoked: z.literal(true) }));
const Summary = z.object({ id: str, label: str, scopes: z.array(str), ...Times });

export type Account = z.infer<typeof User>;
export type MintedPat = z.infer<typeof Minted>['data'];
export type TokenSummary = z.infer<typeof Summary>;

// One credentialed call to auth: the body parsed by `schema`, else a typed error.
const caller =
  (authUrl: string, fetchFn: FetchLike) =>
  async <T>(schema: z.ZodMiniType<T>, path: string, init: RequestInit = {}) => {
    const sent = { ...init, credentials: 'include' as const };
    const res = await fetchFn(`${authUrl}${path}`, sent).catch(unreachable(path));
    const body: unknown = await res.json().catch(() => undefined);
    const parsed = schema.safeParse(body);
    if (res.ok && parsed.success) return parsed.data;
    const plain = { code: `HTTP_${res.status}`, message: `${path} answered ${res.status}` };
    throw fail(Failed.safeParse(body).data?.error ?? plain, res.status);
  };

const JSON_TYPE = { 'content-type': 'application/json' };
const SIGN_OUT = { method: 'POST', headers: JSON_TYPE, body: '{}' };

// auth's REST: the session by cookie, the PAT routes by a short-lived session JWT.
export const authCalls = (authUrl: string, fetchFn: FetchLike) => {
  const call = caller(authUrl, fetchFn);
  const pat = async <T>(schema: z.ZodMiniType<T>, path: string, method: string, body?: object) => {
    const { token } = await call(z.object({ token: str }), '/api/auth/token');
    const headers = { ...JSON_TYPE, authorization: `Bearer ${token}` };
    return call(schema, `/account/pat${path}`, { method, headers, body: JSON.stringify(body) });
  };
  const session = z.nullable(z.object({ user: User }));
  return {
    // get-session answers 200 and null when nobody is signed in.
    account: async () => (await call(session, '/api/auth/get-session'))?.user ?? null,
    mint: async (body: object) => (await pat(Minted, '', 'POST', body)).data,
    list: async () => (await pat(ok(z.array(Summary)), '', 'GET')).data,
    revoke: (id: string) => pat(Revoked, `/${encodeURIComponent(id)}`, 'DELETE'),
    end: () => call(z.object({ success: z.literal(true) }), '/api/auth/sign-out', SIGN_OUT),
  };
};
