import cors, { type CorsOptions } from 'cors';
import express, { type Express, type Request, type RequestHandler } from 'express';
import helmet, { type HelmetOptions } from 'helmet';
import { type WellKnownEntry, type WellKnownRender } from '../api/well-known.js';
import { agcidMiddleware } from '../agcid/scope.js';
import { routeAccess, sameShape } from '../auth/route-access.js';
import { setCaller, type TokenCheck } from '../auth/token-check.js';
import {
  discoveryDocument,
  recordOf,
  type BuildInfo,
  type PartImages,
} from '../discovery/discovery.js';
import { type ExtensionRecord } from '../discovery/discovery.schema.js';
import { createHealthHandler, type HealthCheck } from '../health/health.js';
import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { type ImagePartKind } from '../manifest/primitives.schema.js';
import { errorHandler, notFound } from './errors.js';
import { requestLine } from './request-line.js';
import { type ApiHandler } from './part.types.js';

export interface PartAppBase {
  pkg: ExtensionPackage;
  build: BuildInfo;
  log: Log;
  record?: ExtensionRecord | null;
  ownImage?: string;
  origin?: string;
  checks?: Record<string, HealthCheck>;
  // Set by the runtime for api and mcp parts (auth/part-auth.ts); unset in the test servers.
  tokenCheck?: TokenCheck;
  // The RFC 9728 document a token-protected part serves at /.well-known/oauth-protected-resource.
  resource?: Record<string, unknown>;
}

export interface PartAppOptions extends PartAppBase {
  part: ImagePartKind;
  mount: (app: Express) => void;
  helmet?: HelmetOptions;
}

export interface ApiAppOptions extends PartAppBase {
  router: ApiHandler;
  openapi?: Record<string, unknown> | null;
  wellKnown?: WellKnownEntry[];
  // Registered ctx.route routes: a request none of them matches is 404 before any token check.
  routes?: { method: string; path: string }[];
}

// api-standards section 6: CORS * without credentials on /.well-known/, /api/, /ui/ and /mcp.
export const PUBLIC_CORS: CorsOptions = {
  origin: '*',
  credentials: false,
  allowedHeaders: [
    'Authorization',
    'Content-Type',
    'agcid',
    'traceparent',
    'If-Match',
    'If-None-Match',
  ],
  exposedHeaders: ['agcid', 'ETag', 'Retry-After', 'RateLimit', 'WWW-Authenticate'],
};

// api-standards section 5: parts take bearer tokens only, so no handler or log ever sees a cookie.
const dropCookie: RequestHandler = (req, _res, next) => {
  delete req.headers.cookie;
  next();
};

export const BODY_LIMIT = '1mb';

const requestOrigin = (req: Request): string => `${req.protocol}://${req.get('host') ?? ''}`;

const discoveryHandler = (options: PartAppOptions): RequestHandler => {
  const images: PartImages = options.ownImage ? { [options.part]: options.ownImage } : {};
  const record = options.record ?? recordOf(options.pkg, options.build, images);
  return (req, res) => {
    res.json(discoveryDocument(record, options.origin ?? requestOrigin(req)));
  };
};

const healthHandler = (options: PartAppOptions): RequestHandler =>
  createHealthHandler({
    extension: options.pkg.agentage.id,
    part: options.part,
    version: options.pkg.version,
    build: options.build,
    checks: options.checks,
    log: options.log,
  });

// The kit app every part image runs: agcid, headers, /health, discovery, the part, the envelope.
export const createPartApp = (options: PartAppOptions): Express => {
  const app = express();
  // The gateway calls parts over a private network; its X-Forwarded-Proto then sets req.protocol.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(dropCookie, agcidMiddleware, helmet(options.helmet));
  app.get('/health', healthHandler(options));
  // After /health: it is probed every few seconds and never gets a request line.
  app.use(requestLine(options.log));
  if (options.part !== 'worker') {
    app.use('/.well-known', cors(PUBLIC_CORS));
    app.get('/.well-known/agentage-extension.json', discoveryHandler(options));
    const { resource } = options;
    if (resource)
      app.get('/.well-known/oauth-protected-resource', (_req, res) => void res.json(resource));
  }
  options.mount(app);
  app.use(notFound);
  app.use(errorHandler(options.log));
  return app;
};

// The committed OpenAPI document, bare JSON and anonymous like discovery (api-standards section 1).
const openapiHandler =
  (doc: Record<string, unknown>): RequestHandler =>
  (_req, res) =>
    void res.json(doc);

// Public like discovery, cached briefly: crawlers and registries read these from the root.
const wellKnownHandler =
  (render: WellKnownRender): RequestHandler =>
  async (_req, res) => {
    const doc = await render();
    res.setHeader('Cache-Control', 'public, max-age=300');
    if (typeof doc === 'string') res.type('text/plain').send(doc);
    else res.json(doc);
  };

// Before the body is read: each request checked for the access its OpenAPI operation declares.
const routeGuard =
  (options: ApiAppOptions): RequestHandler =>
  async (req, res, next) => {
    const { routes } = options;
    const known = routes?.find(
      (r) => r.method === req.method.toLowerCase() && sameShape(r.path, req.path)
    );
    if (known) res.locals['route'] = `/api/v1${known.path}`;
    if (!options.tokenCheck || (routes?.length && !known)) return next();
    const access = routeAccess(options.openapi, req.method, `/api/v1${req.path}`);
    const caller = await options.tokenCheck(req.get('authorization'), access);
    if (caller) res.setHeader('Cache-Control', 'no-store');
    setCaller(req, caller);
    next();
  };

export const createApiApp = (options: ApiAppOptions): Express =>
  createPartApp({
    ...options,
    part: 'api',
    mount: (app) => {
      app.use('/api/v1', cors(PUBLIC_CORS));
      for (const { name, render } of options.wellKnown ?? [])
        app.get(`/.well-known/${name}`, wellKnownHandler(render));
      if (options.openapi) app.get('/api/v1/openapi.json', openapiHandler(options.openapi));
      const json = express.json({ limit: BODY_LIMIT });
      app.use('/api/v1', routeGuard(options), json, options.router);
    },
  });
