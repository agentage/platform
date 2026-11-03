import cors, { type CorsOptions } from 'cors';
import express, { type Express, type Request, type RequestHandler } from 'express';
import helmet from 'helmet';
import { agcidMiddleware } from '../agcid/scope.js';
import {
  discoveryDocument,
  recordOf,
  type BuildInfo,
  type PartImages,
} from '../discovery/discovery.js';
import { type ExtensionRecord } from '../discovery/discovery.schema.js';
import { createHealthHandler } from '../health/health.js';
import { type Log } from '../log/log.js';
import { type ExtensionPackage } from '../manifest/manifest.schema.js';
import { errorHandler, notFound } from './errors.js';
import { type ApiHandler } from './part.types.js';

export interface ApiAppOptions {
  pkg: ExtensionPackage;
  build: BuildInfo;
  router: ApiHandler;
  log: Log;
  record?: ExtensionRecord | null;
  ownImage?: string;
  origin?: string;
}

// api-standards section 6: CORS * without credentials on /.well-known/ and /api/.
export const PUBLIC_CORS: CorsOptions = {
  origin: '*',
  credentials: false,
  allowedHeaders: ['Authorization', 'Content-Type', 'agcid', 'traceparent', 'If-Match'],
  exposedHeaders: ['agcid', 'ETag', 'Retry-After', 'RateLimit', 'WWW-Authenticate'],
};

const BODY_LIMIT = '1mb';

const requestOrigin = (req: Request): string => `${req.protocol}://${req.get('host') ?? ''}`;

const discoveryHandler = (options: ApiAppOptions): RequestHandler => {
  const images: PartImages = options.ownImage ? { api: options.ownImage } : {};
  const record = options.record ?? recordOf(options.pkg, options.build, images);
  return (req, res) => {
    res.json(discoveryDocument(record, options.origin ?? requestOrigin(req)));
  };
};

const healthHandler = (options: ApiAppOptions): RequestHandler =>
  createHealthHandler({
    extension: options.pkg.agentage.id,
    part: 'api',
    version: options.pkg.version,
    build: options.build,
  });

export const createApiApp = (options: ApiAppOptions): Express => {
  const app = express();
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(agcidMiddleware, helmet());
  app.get('/health', healthHandler(options));
  app.use('/.well-known', cors(PUBLIC_CORS));
  app.get('/.well-known/agentage-extension.json', discoveryHandler(options));
  app.use('/api/v1', cors(PUBLIC_CORS), express.json({ limit: BODY_LIMIT }), options.router);
  app.use(notFound);
  app.use(errorHandler(options.log));
  return app;
};
