import { type Express, type RequestHandler } from 'express';
import { z } from 'zod';
import { isAudience } from '../auth/part-auth.js';
import { type Env } from '../runtime/build-info.js';
import { createPartApp, type PartAppBase } from '../server/app.js';
import { type PagesSite } from './pages.js';
import { typeOf } from './types.js';

export interface PagesAppOptions extends PartAppBase {
  site: PagesSite;
  // CSP sources a page may load scripts from and call: the issuer and the audience (platformSources).
  platform?: string[];
}

const WEB = ['http:', 'https:'];
const webUrl = (url: string | undefined) => {
  const parsed = url && URL.canParse(url) ? new URL(url) : undefined;
  return parsed && WEB.includes(parsed.protocol) ? parsed : undefined;
};

// A shell page talks to auth and mounts widgets from its siblings: the platform's own hosts only.
export const platformSources = (env: Env): string[] => {
  const issuer = webUrl(env['AGENTAGE_ISSUER'])?.origin;
  const scheme = webUrl(env['AGENTAGE_ORIGIN'])?.protocol ?? 'https:';
  const audience = env['AGENTAGE_AUDIENCE'] ?? '';
  return [issuer, isAudience(audience) ? `${scheme}//${audience}` : undefined].filter(
    (source): source is string => Boolean(source)
  );
};

const BODY = z.union([z.string(), z.instanceof(Uint8Array)]);
const ENTRY = z.union([BODY, z.object({ type: z.string().min(1), body: BODY })]);
const SiteSchema = z.record(z.string().regex(/^\/[A-Za-z0-9._~/-]*$/), ENTRY);

export const NOT_FOUND_PAGE =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Not found</p></body></html>\n';

const serve =
  (site: PagesSite): RequestHandler =>
  (req, res, next) => {
    const entry = site[req.path];
    if (entry === undefined) return next();
    const { type, body } = typeof entry === 'object' && 'type' in entry ? entry : { body: entry };
    res.type(type ?? typeOf(req.path)).setHeader('Cache-Control', 'no-cache');
    // express sends a Buffer as bytes but a plain Uint8Array as JSON.
    res.send(
      typeof body === 'string' ? body : Buffer.from(body.buffer, body.byteOffset, body.length)
    );
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
