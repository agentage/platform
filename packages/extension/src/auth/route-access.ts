import { accessOfSecurity, type Access } from './token-check.js';

type Operations = Record<string, { security?: unknown } | undefined>;

const sameShape = (template: string, path: string): boolean => {
  const want = template.split('/');
  const got = path.split('/');
  return (
    want.length === got.length && want.every((seg, i) => /^\{.+\}$/.test(seg) || seg === got[i])
  );
};

// The access the committed OpenAPI declares for a request: its operation's security, else the document's.
export const routeAccess = (
  doc: Record<string, unknown> | null | undefined,
  method: string,
  path: string
): Access => {
  const paths = (doc?.['paths'] ?? {}) as Record<string, Operations>;
  const template = Object.keys(paths).find((candidate) => sameShape(candidate, path));
  const operation = template ? paths[template]?.[method.toLowerCase()] : undefined;
  if (!operation) return 'read';
  return accessOfSecurity(operation.security ?? doc?.['security']);
};
