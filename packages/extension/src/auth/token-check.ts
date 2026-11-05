// What a route or tool declares (api-standards section 5): public, or a verb on the extension's own scope.
export type Access = 'public' | 'read' | 'write' | 'admin';

export interface Caller {
  sub: string;
  scopes: readonly string[];
}

// The host's token check: a caller (null for public), or a thrown UNAUTHORIZED, FORBIDDEN or UNAVAILABLE.
// Kit 0.2 runs none (tokens off): calls stay anonymous; M3 passes one verifying against the JWKS.
export type TokenCheck = (
  authorization: string | undefined,
  access: Access
) => Promise<Caller | null>;

const RANK: Record<Access, number> = { public: 0, read: 1, write: 2, admin: 3 };

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
