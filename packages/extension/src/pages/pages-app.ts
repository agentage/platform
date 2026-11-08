import { extname } from 'node:path';
import { type Express, type RequestHandler } from 'express';
import { z } from 'zod';
import { createPartApp, type PartAppBase } from '../server/app.js';
import { browserCsp } from '../server/browser-csp.js';
import { type PagesSite } from './pages.js';

export interface PagesAppOptions extends PartAppBase {
  site: PagesSite;
  issuer?: string;
  devIssuer?: string;
}

const SiteSchema = z.record(z.string().regex(/^\/[A-Za-z0-9._~/-]*$/), z.string());

export const NOT_FOUND_PAGE =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><p>Not found</p></body></html>\n';

const TYPED = new Set(['.js', '.mjs', '.css', '.json', '.svg', '.png', '.ico', '.html']);

// Typed by extension through express's mime table, as the ui part's static files are; else HTML.
const typeOf = (path: string): string => (TYPED.has(extname(path)) ? extname(path) : 'html');

const serve =
  (site: PagesSite): RequestHandler =>
  (req, res, next) => {
    const body = site[req.path];
    if (body === undefined) return next();
    res.type(typeOf(req.path)).setHeader('Cache-Control', 'no-cache');
    res.send(body);
  };

const missing: RequestHandler = (_req, res) => {
  res.status(404).type('html').send(NOT_FOUND_PAGE);
};

// Everything the gateway does not reserve comes here: a file from the site map, or an HTML 404.
export const createPagesApp = (options: PagesAppOptions): Express => {
  const site = SiteSchema.parse(options.site);
  return createPartApp({
    ...options,
    part: 'pages',
    helmet: { contentSecurityPolicy: browserCsp(options) },
    mount: (app) => {
      app.get(/.*/, serve(site));
      app.get(/.*/, missing);
    },
  });
};
