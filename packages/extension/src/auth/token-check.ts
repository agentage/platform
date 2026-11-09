import { setTimeout as sleep } from 'node:timers/promises';
import { requestScope } from '../agcid/current.js';

// What a route or tool declares (api-standards section 5): public, optional (anonymous or a read bearer), or a verb.
export const ACCESS = ['public', 'optional', 'read', 'write', 'admin'] as const;
export type Access = (typeof ACCESS)[number];

export const VERBS = ['read', 'write', 'admin'] as const;

// Where a route or a tool may declare its scope: tools have no optional.
export const badScope = (scope: unknown, allowed: readonly Access[] = ACCESS): string | null =>
  scope === undefined || allowed.includes(scope as Access)
    ? null
    : `scope ${String(scope)}: one of ${allowed.join(', ')}`;

export interface Caller {
  sub: string;
  scopes: readonly string[];
}

// The token id beside a caller, never on it: the log's session when the client sends no agsid.
const tokenIds = new WeakMap<Caller, string>();

export const withJti = (caller: Caller, jti: string | undefined): Caller => {
  if (jti !== undefined) tokenIds.set(caller, jti);
  return caller;
};

// A caller, or a thrown UNAUTHORIZED, FORBIDDEN or UNAVAILABLE (verify-token.ts).
export type TokenCheck = (
  authorization: string | undefined,
  access: Access
) => Promise<Caller | null>;

const callers = new WeakMap<object, Caller | null>();

// Also the request scope's sub and session, so every row after the check says who.
export const setCaller = (request: object, caller: Caller | null): void => {
  callers.set(request, caller);
  const scope = requestScope.getStore();
  if (!scope || !caller) return;
  scope.sub = caller.sub;
  scope.session ??= tokenIds.get(caller) ?? null;
};

export const callerOf = (request: object): Caller | null => callers.get(request) ?? null;

export const rank = (access: Access): number => ACCESS.indexOf(access);

export const scopeOf = (id: string, access: Access = 'read'): string =>
  access === 'public' ? 'public' : `${id}:${access === 'optional' ? 'read' : access}`;

export const strongest = (needed: readonly Access[]): Access =>
  needed.reduce<Access>((top, access) => (rank(access) > rank(top) ? access : top), 'public');

const VERB = new RegExp(`:(${VERBS.join('|')})$`);

const isAnonymous = (requirement: unknown): boolean =>
  typeof requirement === 'object' && requirement !== null && Object.keys(requirement).length === 0;

// OpenAPI security: [] is public, [{}, {pat}] optional, a scope names the verb; nothing declared needs read.
export const accessOfSecurity = (security: unknown): Access => {
  if (Array.isArray(security) && security.length === 0) return 'public';
  const requirements: unknown[] = Array.isArray(security) ? security : [];
  const scopes = requirements
    .flatMap((requirement: unknown) => Object.values(requirement ?? {}) as unknown[])
    .flat()
    .filter((scope): scope is string => typeof scope === 'string');
  const verbs = scopes.map((scope) => (VERB.exec(scope)?.[1] as Access | undefined) ?? 'read');
  if (requirements.some(isAnonymous)) return verbs.length === 0 ? 'public' : 'optional';
  return verbs.length === 0 ? 'read' : strongest(verbs);
};

// security.md: a failed read of the issuer is tried once more before it counts as an outage.
export const retryOnce = <T>(read: () => Promise<T>, retries = (_err: unknown) => true) =>
  read().catch(async (err: unknown) => {
    if (!retries(err)) throw err;
    await sleep(1000);
    return read();
  });
