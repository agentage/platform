import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

export const AUTH = 'https://auth.example.test';
export const DAY_MS = 86_400_000;

export type Route = (init: RequestInit) => [number, unknown];
interface Pair<T = unknown> {
  request: { method: string; path: string; body?: unknown };
  response: { status: number; body: T };
}
type Minted = { success: true; data: Record<string, unknown> };
type Session = { user: { id: string; email: string; name: string } };

// auth's wire as committed in fixtures/: the fake answers each request with its recorded response.
const pair = <T = unknown>(name: string): Pair<T> =>
  JSON.parse(readFileSync(new URL(`../../fixtures/auth-${name}.json`, import.meta.url), 'utf8'));
export const wire = {
  session: pair<Session>('get-session'),
  jwt: pair('token'),
  mint: pair<Minted>('mint'),
  list: pair('list'),
  revoke: pair('revoke'),
  signOut: pair('sign-out'),
};
const key = ({ request }: Pair) => `${request.method} ${request.path}`;
const reply = ({ response }: Pair): [number, unknown] => [response.status, response.body];
const { user } = wire.session.response.body;
export const USER = { id: user.id, email: user.email, name: user.name };

// One mint per call, numbered, expiring a day after now.
const mintRoute =
  (count: () => number): Route =>
  () => {
    const n = count();
    const data = { ...wire.mint.response.body.data, id: `tok_${n}`, token: `aga_${n}` };
    const expiresAt = new Date(Date.now() + DAY_MS).toISOString();
    return [
      wire.mint.response.status,
      { ...wire.mint.response.body, data: { ...data, expiresAt } },
    ];
  };

// A fake auth: one handler per "METHOD /path", every call recorded.
export const fakeAuth = (overrides: Record<string, Route> = {}) => {
  let session = true;
  let minted = 0;
  const calls: { at: string; init: RequestInit }[] = [];
  const routes: Record<string, Route> = {
    [key(wire.session)]: () => (session ? reply(wire.session) : [200, null]),
    [key(wire.jwt)]: () => (session ? reply(wire.jwt) : [401, {}]),
    [key(wire.mint)]: mintRoute(() => (minted += 1)),
    [key(wire.list)]: () => reply(wire.list),
    [key(wire.revoke)]: () => reply(wire.revoke),
    [key(wire.signOut)]: () => ((session = false), reply(wire.signOut)),
    ...overrides,
  };
  const fetch = vi.fn(async (url: string, init: RequestInit = {}) => {
    const at = `${init.method ?? 'GET'} ${url.slice(AUTH.length)}`;
    calls.push({ at, init });
    const route = routes[at];
    if (!route) return new Response('{}', { status: 404 });
    const [status, body] = route(init);
    return new Response(JSON.stringify(body), { status });
  });
  return { fetch, calls, at: () => calls.map((c) => c.at), signOutNow: () => (session = false) };
};
