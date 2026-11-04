import cors, { type CorsOptions } from 'cors';
import express, { type Express, type Request, type RequestHandler } from 'express';
import helmet, { type HelmetOptions } from 'helmet';
import { agcidMiddleware } from '../agcid/scope.js';
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
import { type ApiHandler } from './part.types.js';

export interface PartAppBase {
  pkg: ExtensionPackage;
  build: BuildInfo;
  log: Log;
  record?: ExtensionRecord | null;
  ownImage?: string;
  origin?: string;
  checks?: Record<string, HealthCheck>;
}

export interface PartAppOptions extends PartAppBase {
  part: ImagePartKind;
  mount: (app: Express) => void;
  helmet?: HelmetOptions;
}

export interface ApiAppOptions extends PartAppBase {
  router: ApiHandler;
  openapi?: Record<string, unknown> | null;
}

// api-standards section 6: CORS * without credentials on /.well-known/, /api/, /ui/ and /mcp.
export const PUBLIC_CORS: CorsOptions = {
  origin: '*',
  credentials: false,
  allowedHeaders: ['Authorization', 'Content-Type', 'agcid', 'traceparent', 'If-Match'],
  exposedHeaders: ['agcid', 'ETag', 'Retry-After', 'RateLimit', 'WWW-Authenticate'],
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
  });

// The kit app every part image runs: agcid, headers, /health, discovery, the part, the envelope.
export const createPartApp = (options: PartAppOptions): Express => {
  const app = express();
  // The gateway calls parts over a private network; its X-Forwarded-Proto then sets req.protocol.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(agcidMiddleware, helmet(options.helmet));
  app.get('/health', healthHandler(options));
  if (options.part !== 'worker') {
    app.use('/.well-known', cors(PUBLIC_CORS));
    app.get('/.well-known/agentage-extension.json', discoveryHandler(options));
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

export const createApiApp = (options: ApiAppOptions): Express =>
  createPartApp({
    ...options,
    part: 'api',
    mount: (app) => {
      app.use('/api/v1', cors(PUBLIC_CORS));
      if (options.openapi) app.get('/api/v1/openapi.json', openapiHandler(options.openapi));
      app.use('/api/v1', express.json({ limit: BODY_LIMIT }), options.router);
    },
  });
