import { Router, type RequestHandler } from 'express';
import { inQuery } from '../api/openapi-doc.js';
import { createRouteRegistry, type ApiContext, type RouteEntry } from '../api/routes.js';
import { type WellKnownEntry } from '../api/well-known.js';
import { type PartContext } from '../context/context.js';
import { isReply, ok, reply } from '../envelope/envelope.js';
import { parse } from '../envelope/parse.js';
import { type ApiHandler } from './part.types.js';

const inputOf = ({ method, spec }: RouteEntry, query: unknown, body: unknown) => {
  if (!spec.input) return {};
  if (inQuery(method)) return parse(spec.input, query, 'Invalid query');
  return parse(spec.input, body ?? {}, 'Invalid body');
};

// Validated in, the handler's data (bare or a reply) parsed by its output schema and sent in the envelope.
const handlerOf =
  (ctx: PartContext, entry: RouteEntry): RequestHandler =>
  async (req, res) => {
    const input = inputOf(entry, req.query, req.body);
    const caller = ctx.auth.caller(req);
    const { params: schema } = entry.spec;
    const params = schema ? parse(schema, req.params, 'Invalid path') : req.params;
    const ifMatch = req.get('if-match');
    const answer = await entry.handler({
      input,
      params,
      caller,
      ifMatch,
      header: (name) => req.get(name),
    });
    const { data, meta, etag, status = 200 } = isReply(answer) ? answer : reply(answer);
    if (etag) res.setHeader('ETag', etag);
    if (status === 204) return void res.status(204).end();
    res.status(status);
    res.json(ok(entry.spec.output ? entry.spec.output.parse(data) : data, meta));
  };

// /items/{id} as Express writes it.
const expressPath = (path: string): string => path.replace(/\{(\w+)\}/g, ':$1');

const routesRouter = (ctx: PartContext, routes: RouteEntry[]): Router => {
  const router = Router();
  for (const entry of routes) router[entry.method](expressPath(entry.path), handlerOf(ctx, entry));
  return router;
};

// What create(ctx) gave: its ctx.route routes, or the router it returned; exactly one.
const handlerFor = (ctx: PartContext, routes: RouteEntry[], returned: unknown): ApiHandler => {
  if (routes.length > 0 && returned)
    throw new Error('the api part registers ctx.route routes and returns a router: pick one');
  if (routes.length > 0) return routesRouter(ctx, routes);
  if (!returned) throw new Error('the api part registers nothing and returns no router');
  return returned as ApiHandler;
};

// Runs the api part's create(ctx) with ctx.route; the runtime and the test server mount alike.
export const mountApi = async (
  ctx: PartContext,
  create: (ctx: ApiContext) => unknown
): Promise<{ router: ApiHandler; routes: RouteEntry[]; documents: WellKnownEntry[] }> => {
  const { route, routes, wellKnown, documents } = createRouteRegistry();
  const returned = await create({ ...ctx, route, wellKnown });
  return { router: handlerFor(ctx, routes, returned), routes, documents };
};
