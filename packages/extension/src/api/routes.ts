import { type z } from 'zod';
import { type Access, type Caller } from '../auth/token-check.js';
import { type PartContext } from '../context/context.js';

export const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export type RouteMethod = (typeof ROUTE_METHODS)[number];

type ObjectSchema = z.ZodObject;

export interface RouteSpec<I extends ObjectSchema, O extends z.ZodType> {
  summary: string;
  // What the route needs: {id}:{scope}, or public; read when left out.
  scope?: Access;
  // get and delete read it from the query, post, put and patch from the JSON body.
  input?: I;
  output?: O;
}

// The {name} segments of a path, each a string.
export type ParamsOf<P extends string> = P extends `${string}{${infer N}}${infer R}`
  ? { [K in N]: string } & ParamsOf<R>
  : Record<never, string>;

export interface RouteRequest<I, P extends string> {
  input: I;
  params: ParamsOf<P>;
  caller: Caller | null;
}

export type RouteHandler<I extends ObjectSchema, O extends z.ZodType, P extends string> = (
  request: RouteRequest<z.output<I>, P>
) => z.input<O> | Promise<z.input<O>>;

// Registers a route under /api/v1; the kit validates, wraps the envelope and writes openapi.json.
export type RouteRegistrar = <
  P extends string,
  I extends ObjectSchema = z.ZodObject<Record<never, z.ZodType>>,
  O extends z.ZodType = z.ZodUnknown,
>(
  method: RouteMethod,
  path: P,
  spec: RouteSpec<I, O>,
  handler: RouteHandler<I, O, P>
) => void;

export interface ApiContext extends PartContext {
  readonly route: RouteRegistrar;
}

export interface RouteEntry {
  method: RouteMethod;
  path: string;
  spec: RouteSpec<ObjectSchema, z.ZodType>;
  handler: (request: RouteRequest<Record<string, unknown>, string>) => unknown;
}

const PATH = /^(\/([A-Za-z0-9._~-]+|\{[A-Za-z_][A-Za-z0-9_]*\}))+$/;
const SCOPES: readonly Access[] = ['public', 'read', 'write', 'admin'];

const problemOf = (routes: RouteEntry[], { method, path, spec }: RouteEntry) => {
  if (!ROUTE_METHODS.includes(method))
    return `method ${String(method)}: one of get, post, put, patch, delete`;
  if (!PATH.test(path)) return 'path: /segments and {param} segments under /api/v1';
  if (routes.some((r) => r.method === method && r.path === path)) return 'is registered twice';
  if (!spec.summary) return 'needs a summary: it documents the route';
  if (spec.scope !== undefined && !SCOPES.includes(spec.scope))
    return `scope ${String(spec.scope)}: one of ${SCOPES.join(', ')}`;
  return null;
};

export const createRouteRegistry = () => {
  const routes: RouteEntry[] = [];
  const route: RouteRegistrar = (method, path, spec, handler) => {
    const entry = { method, path, spec, handler: handler as RouteEntry['handler'] };
    const problem = problemOf(routes, entry);
    if (problem) throw new Error(`route ${String(method).toUpperCase()} ${path} ${problem}`);
    routes.push(entry);
  };
  return { route, routes };
};
