import cors from 'cors';
import express, { type Express } from 'express';
import { createPartApp, PUBLIC_CORS, type PartAppBase } from '../server/app.js';

export interface UiAppOptions extends PartAppBase {
  dir: string;
}

// Widgets reach their own /mcp and /api only; the dev issuer of `up` is the one other origin.
const CSP = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    connectSrc: ["'self'", 'http://localhost:4281', 'http://127.0.0.1:4281'],
    imgSrc: ["'self'", 'data:'],
    upgradeInsecureRequests: null,
  },
};

const IMMUTABLE = 'public, max-age=31536000, immutable';

// /ui/{version}/: static widget modules, anonymous, cached forever (a version never changes).
export const createUiApp = (options: UiAppOptions): Express =>
  createPartApp({
    ...options,
    part: 'ui',
    helmet: { contentSecurityPolicy: CSP, crossOriginResourcePolicy: { policy: 'cross-origin' } },
    mount: (app) =>
      void app.use(
        `/ui/${options.pkg.version}`,
        cors(PUBLIC_CORS),
        express.static(options.dir, {
          index: false,
          fallthrough: true,
          setHeaders: (res) => res.setHeader('Cache-Control', IMMUTABLE),
        })
      ),
  });
