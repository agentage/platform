import { accessOfSecurity, type Access } from './token-check.js';

type Operations = Record<string, { security?: unknown } | undefined>;

const PARAM = /^\{.+\}$/;

// As Express routes: without case, and one trailing slash ignored.
const sameShape = (template: string, path: string): boolean => {
  const want = template.toLowerCase().split('/');
  const got = path
    .toLowerCase()
    .replace(/(.)\/$/, '$1')
    .split('/');
  return want.length === got.length && want.every((seg, i) => PARAM.test(seg) || seg === got[i]);
};

const params = (template: string): number =>
  template.split('/').filter((seg) => PARAM.test(seg)).length;

// As OpenAPI matches: a concrete path before a template, then the template with the fewest params.
const mostSpecific = (templates: string[], path: string): string | undefined =>
  templates
    .filter((template) => sameShape(template, path))
    .sort((a, b) => params(a) - params(b))[0];

// The access the committed OpenAPI declares for a request: its operation's, else the document's.
export const routeAccess = (
  doc: Record<string, unknown> | null | undefined,
  method: string,
  path: string
): Access => {
  const paths = (doc?.['paths'] ?? {}) as Record<string, Operations>;
  const template = mostSpecific(Object.keys(paths), path);
  const operation = template ? paths[template]?.[method.toLowerCase()] : undefined;
  if (!operation) return 'read';
  return accessOfSecurity(operation.security ?? doc?.['security']);
};
