import { extname } from 'node:path';
import { type Express, type RequestHandler } from 'express';
import { z } from 'zod';
import { type Env } from '../runtime/build-info.js';
import { createPartApp, type PartAppBase } from '../server/app.js';
import { type PagesSite } from './pages.js';

export interface PagesAppOptions extends PartAppBase {
  site: PagesSite;
  // CSP sources a page may load scripts from and call: the issuer and the audience (platformSources).
  platform?: string[];
}

const AUDIENCE = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/;
const originOf = (url: string | undefined) => (url && URL.canParse(url) ? new URL(url) : undefined);

// A shell page talks to auth and mounts widgets from its siblings: the platform's own hosts only.
export const platformSources = (env: Env): string[] => {
  const issuer = originOf(env['AGENTAGE_ISSUER'])?.origin;
  const scheme = originOf(env['AGENTAGE_ORIGIN'])?.protocol ?? 'https:';
  const audience = env['AGENTAGE_AUDIENCE'] ?? '';
  return [issuer, AUDIENCE.test(audience) ? `${scheme}//${audience}` : undefined].filter(
    (source): source is string => Boolean(source)
  );
};

const TYPES: Record<string, string> = { '.js': 'js', '.mjs': 'js', '.css': 'css', '.json': 'json' };

const SiteSchema = z.record(z.string().regex(/^\/[A-Za-z0-9._~/-]*$/), z.string());

export const NOT_FOUND_PAGE =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Not found</p></body></html>\n';

const serve =
  (site: PagesSite): RequestHandler =>
  (req, res, next) => {
    const html = site[req.path];
    if (html === undefined) return next();
    res.type(TYPES[extname(req.path)] ?? 'html').setHeader('Cache-Control', 'no-cache');
    res.send(html);
  };

const missing: RequestHandler = (_req, res) => {
  res.status(404).type('html').send(NOT_FOUND_PAGE);
};

// Everything the gateway does not reserve comes here: a site map entry (typed by its extension), or an HTML 404.
export const createPagesApp = (options: PagesAppOptions): Express => {
  const site = SiteSchema.parse(options.site);
  return createPartApp({
    ...options,
    part: 'pages',
    helmet: {
      contentSecurityPolicy: {
        directives: {
          scriptSrc: ["'self'", ...(options.platform ?? [])],
          connectSrc: ["'self'", ...(options.platform ?? [])],
          upgradeInsecureRequests: null,
        },
      },
    },
    mount: (app) => {
      app.get(/.*/, serve(site));
      app.get(/.*/, missing);
    },
  });
};
