import { type z } from 'zod';
import { type Access, type Caller } from '../auth/token-check.js';
import { type PartContext } from '../context/context.js';
import { type Reply } from '../envelope/envelope.js';
import { createWellKnownRegistry, type WellKnownRegistrar } from './well-known.js';

export const ROUTE_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export type RouteMethod = (typeof ROUTE_METHODS)[number];

type ObjectSchema = z.ZodObject;

export interface RouteSpec<
  I extends ObjectSchema,
  O extends z.ZodType,
  S extends Access = Access,
  Q extends ObjectSchema = never,
> {
  summary: string;
  // What the route needs: {id}:{scope}, or public; read when left out.
  scope?: S;
  // get and delete read it from the query, post, put and patch from the JSON body.
  input?: I;
  output?: O;
  // The {name} segments parsed like input; strings when left out.
  params?: Q;
  // The route sends an ETag and reads If-Match: the contract adds both headers and 412.
  etag?: true;
}

// The {name} segments of a path, each a string.
export type ParamsOf<P extends string> = P extends `${string}{${infer N}}${infer R}`
  ? { [K in N]: string } & ParamsOf<R>
  : Record<never, string>;

// The token check ran before a scoped route, so only a public or optional one can be anonymous.
export interface RouteRequest<I, P extends string, S extends Access = Access, Q = never> {
  input: I;
  params: [Q] extends [never] ? ParamsOf<P> : Q;
  caller: S extends 'public' | 'optional' ? Caller | null : Caller;
  ifMatch?: string;
}

type Answer<T> = T | Reply<T>;

export type RouteHandler<
  I extends ObjectSchema,
  O extends z.ZodType,
  P extends string,
  S extends Access = Access,
  Q extends ObjectSchema = never,
> = (
  request: RouteRequest<z.output<I>, P, S, [Q] extends [never] ? never : z.output<Q>>
) => Answer<z.input<O>> | Promise<Answer<z.input<O>>>;

// Registers a route under /api/v1; the kit validates, wraps the envelope and writes openapi.json.
export type RouteRegistrar = <
  P extends string,
  I extends ObjectSchema = z.ZodObject<Record<never, z.ZodType>>,
  O extends z.ZodType = z.ZodUnknown,
  S extends Access = 'read',
  Q extends ObjectSchema = never,
>(
  method: RouteMethod,
  path: P,
  spec: RouteSpec<I, O, S, Q>,
  handler: RouteHandler<I, O, P, S, Q>
) => void;

export interface ApiContext extends PartContext {
  readonly route: RouteRegistrar;
  readonly wellKnown: WellKnownRegistrar;
}

type Params = Record<string, unknown>;

export interface RouteEntry {
  method: RouteMethod;
  path: string;
  spec: RouteSpec<ObjectSchema, z.ZodType, Access, ObjectSchema>;
  handler: (request: RouteRequest<Record<string, unknown>, string, 'public', Params>) => unknown;
}

const PATH = /^(\/([A-Za-z0-9._~-]+|\{[A-Za-z_][A-Za-z0-9_]*\}))+$/;
const SCOPES: readonly Access[] = ['public', 'optional', 'read', 'write', 'admin'];

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
  return { route, routes, ...createWellKnownRegistry() };
};
