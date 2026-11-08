import { type Request, type RequestHandler } from 'express';
import { agcidOfResponse } from '../agcid/scope.js';
import { logAt, type Log, type LogLevel } from '../log/log.js';

const MOUNTS = ['/api/v1', '/mcp', '/.well-known', '/ui'];

const levelOf = (status: number): LogLevel =>
  status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';

// The matched route template, never the raw URL, so no id or query string reaches the log.
export const routeOf = (req: Request): string => {
  const url = req.originalUrl.split('?')[0] ?? '';
  const prefix = MOUNTS.find((m) => url === m || url.startsWith(`${m}/`)) ?? '/';
  const path: unknown = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string') return prefix;
  return path.startsWith(prefix) ? path : `${prefix}${path}`;
};

// One line per request on finish; the 5xx error itself is errors.ts's line, never repeated here.
export const requestLine =
  (log: Log): RequestHandler =>
  (req, res, next) => {
    const start = performance.now();
    res.on('finish', () => {
      const { statusCode: status } = res;
      const ms = Math.round(performance.now() - start);
      const fields = { agcid: agcidOfResponse(res), method: req.method, route: routeOf(req) };
      logAt(log, levelOf(status), 'request', { ...fields, status, ms });
    });
    next();
  };
