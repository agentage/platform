import { Router, type RequestHandler } from 'express';
import { type RouteEntry } from '../api/routes.js';
import { type PartContext } from '../context/context.js';
import { ok } from '../envelope/envelope.js';
import { parse } from '../envelope/parse.js';
import { type ApiHandler } from './part.types.js';

const inQuery = (method: string) => method === 'get' || method === 'delete';

const inputOf = ({ method, spec }: RouteEntry, query: unknown, body: unknown) => {
  if (!spec.input) return {};
  if (inQuery(method)) return parse(spec.input, query, 'Invalid query');
  return parse(spec.input, body ?? {}, 'Invalid body');
};

// Validated in, the handler's answer parsed by its output schema and sent in the envelope.
const handlerOf =
  (ctx: PartContext, entry: RouteEntry): RequestHandler =>
  async (req, res) => {
    const input = inputOf(entry, req.query, req.body);
    const caller = ctx.auth.caller(req);
    const data = await entry.handler({ input, params: req.params, caller });
    res.json(ok(entry.spec.output ? entry.spec.output.parse(data) : data));
  };

// /items/{id} as Express writes it.
const expressPath = (path: string): string => path.replace(/\{(\w+)\}/g, ':$1');

const routesRouter = (ctx: PartContext, routes: RouteEntry[]): Router => {
  const router = Router();
  for (const entry of routes) router[entry.method](expressPath(entry.path), handlerOf(ctx, entry));
  return router;
};

// What create(ctx) gave: its ctx.route routes, or the router it returned; never both.
export const apiHandlerOf = (
  ctx: PartContext,
  routes: RouteEntry[],
  returned: unknown
): ApiHandler => {
  if (routes.length === 0) return returned as ApiHandler;
  if (returned)
    throw new Error('the api part registers ctx.route routes and returns a router: pick one');
  return routesRouter(ctx, routes);
};
