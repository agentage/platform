import cors from 'cors';
import express, { type Express } from 'express';
import { createPartApp, PUBLIC_CORS, type PartAppBase } from '../server/app.js';
import { browserCsp } from '../server/browser-csp.js';

export interface UiAppOptions extends PartAppBase {
  dir: string;
  issuer?: string;
  // The dev issuer's origin; only `up` sets it, so a deployed ui never lets widgets reach it.
  devIssuer?: string;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1']);

// AGENTAGE_DEV_ISSUER, when set, must be a loopback http origin: anything else stops the start.
export const devIssuerOrigin = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (url?.protocol !== 'http:' || !LOOPBACK.has(url.hostname))
    throw new Error(`AGENTAGE_DEV_ISSUER ${value} is not a loopback http origin`);
  return url.origin;
};

const IMMUTABLE = 'public, max-age=31536000, immutable';

// /ui/{version}/: static widget modules, anonymous, cached forever (a version never changes).
export const createUiApp = (options: UiAppOptions): Express =>
  createPartApp({
    ...options,
    part: 'ui',
    helmet: {
      contentSecurityPolicy: browserCsp({
        ...options,
        devIssuer: devIssuerOrigin(options.devIssuer),
      }),
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    },
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
