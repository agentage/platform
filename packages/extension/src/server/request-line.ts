import { type Request, type RequestHandler, type Response } from 'express';
import { requestScope } from '../agcid/current.js';
import { type Log } from '../log/log.js';

const MOUNTS = ['/api/v1', '/mcp', '/.well-known', '/ui'];
const ASSET = /\.(m?js|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf)$/i;

// The matched route template, never the raw URL, so no id or query string reaches the log.
export const routeOf = (req: Request, res?: Response): string => {
  const known: unknown = res?.locals?.['route'];
  if (typeof known === 'string') return known;
  const url = req.originalUrl?.split('?')[0] ?? '';
  const prefix = MOUNTS.find((m) => url === m || url.startsWith(`${m}/`)) ?? '';
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') return '(unmatched)';
  return path.startsWith(prefix) ? path : `${prefix}${path}`;
};

// A tools/call is its mcp row (Q1); a page asset served fine leaves none (Q2).
const skipped = (req: Request, res: Response): boolean =>
  res.locals['toolCall'] === true || (res.statusCode < 400 && ASSET.test(req.path));

const localOf = (res: Response, key: string): string | undefined => {
  const value: unknown = res.locals[key];
  return typeof value === 'string' ? value : undefined;
};

// One http row per request on finish; a ctx.exit() asked for in it shuts the part down after.
export const requestLine =
  (log: Log): RequestHandler =>
  (req, res, next) => {
    const start = performance.now();
    const scope = requestScope.getStore();
    res.on('finish', () => {
      if (!skipped(req, res))
        log.http({
          method: req.method,
          route: routeOf(req, res),
          status: res.statusCode,
          ms: Math.round(performance.now() - start),
          bytes: Number(res.getHeader('content-length') ?? 0),
          reason: localOf(res, 'authReason'),
          errorType: localOf(res, 'errorType'),
          clientInfo: localOf(res, 'clientInfo'),
        });
      if (scope?.exit) process.kill(process.pid, 'SIGTERM');
    });
    next();
  };
