import { type Express, type RequestHandler } from 'express';
import { z } from 'zod';
import { createPartApp, type PartAppBase } from '../server/app.js';
import { type PagesSite } from './pages.js';

export interface PagesAppOptions extends PartAppBase {
  site: PagesSite;
}

const SiteSchema = z.record(z.string().regex(/^\/[A-Za-z0-9._~/-]*$/), z.string());

export const NOT_FOUND_PAGE =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Not found</p></body></html>\n';

const serve =
  (site: PagesSite): RequestHandler =>
  (req, res, next) => {
    const html = site[req.path];
    if (html === undefined) return next();
    res.type('html').setHeader('Cache-Control', 'no-cache');
    res.send(html);
  };

const missing: RequestHandler = (_req, res) => {
  res.status(404).type('html').send(NOT_FOUND_PAGE);
};

// Everything the gateway does not reserve comes here: a page from the site map, or an HTML 404.
export const createPagesApp = (options: PagesAppOptions): Express => {
  const site = SiteSchema.parse(options.site);
  return createPartApp({
    ...options,
    part: 'pages',
    helmet: { contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } },
    mount: (app) => {
      app.get(/.*/, serve(site));
      app.get(/.*/, missing);
    },
  });
};
