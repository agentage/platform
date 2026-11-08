import { setTimeout as sleep } from 'node:timers/promises';

// What a route or tool declares (api-standards section 5): public, optional (anonymous or a read bearer), or a verb.
export type Access = 'public' | 'optional' | 'read' | 'write' | 'admin';

export interface Caller {
  sub: string;
  scopes: readonly string[];
}

// A caller, or a thrown UNAUTHORIZED, FORBIDDEN or UNAVAILABLE (verify-token.ts).
export type TokenCheck = (
  authorization: string | undefined,
  access: Access
) => Promise<Caller | null>;

const callers = new WeakMap<object, Caller | null>();

export const setCaller = (request: object, caller: Caller | null): void =>
  void callers.set(request, caller);

export const callerOf = (request: object): Caller | null => callers.get(request) ?? null;

export const RANK: Record<Access, number> = { public: 0, optional: 1, read: 2, write: 3, admin: 4 };

export const scopeOf = (id: string, access: Access = 'read'): string =>
  access === 'public' ? 'public' : `${id}:${access === 'optional' ? 'read' : access}`;

export const strongest = (needed: readonly Access[]): Access =>
  needed.reduce<Access>((top, access) => (RANK[access] > RANK[top] ? access : top), 'public');

const VERB = /:(read|write|admin)$/;

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
