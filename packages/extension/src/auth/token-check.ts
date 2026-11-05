// What a route or tool declares (api-standards section 5): public, or a verb on the extension's own scope.
export type Access = 'public' | 'read' | 'write' | 'admin';

export interface Caller {
  sub: string;
  scopes: readonly string[];
}

// A caller, or a thrown UNAUTHORIZED, FORBIDDEN or UNAVAILABLE (verify-token.ts).
export type TokenCheck = (
  authorization: string | undefined,
  access: Access
) => Promise<Caller | null>;

// Read by part code only through ctx.auth.caller(request).
const callers = new WeakMap<object, Caller | null>();

export const setCaller = (request: object, caller: Caller | null): void =>
  void callers.set(request, caller);

export const callerOf = (request: object): Caller | null => callers.get(request) ?? null;

export const RANK: Record<Access, number> = { public: 0, read: 1, write: 2, admin: 3 };

// The scope a route or tool declares, as tokens and the record name it: {id}:{verb}, or public.
export const scopeOf = (id: string, access: Access = 'read'): string =>
  access === 'public' ? 'public' : `${id}:${access}`;

export const strongest = (needed: readonly Access[]): Access =>
  needed.reduce<Access>((top, access) => (RANK[access] > RANK[top] ? access : top), 'public');

const VERB = /:(read|write|admin)$/;

// OpenAPI security: [] is public, a scope names the verb; a route that declares nothing needs read.
export const accessOfSecurity = (security: unknown): Access => {
  if (Array.isArray(security) && security.length === 0) return 'public';
  const scopes = (Array.isArray(security) ? security : [])
    .flatMap((requirement: unknown) => Object.values(requirement ?? {}) as unknown[])
    .flat()
    .filter((scope): scope is string => typeof scope === 'string');
  const verbs = scopes.map((scope) => (VERB.exec(scope)?.[1] as Access | undefined) ?? 'read');
  return verbs.length === 0 ? 'read' : strongest(verbs);
};
