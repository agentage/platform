import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { Router } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runPart } from '../runtime/run-part.js';
import { createApiApp } from '../server/app.js';
import { recordedLog, serveApp, type Served } from '../test-support/http.js';
import { API_MANIFEST, json, SHA, tempPackage } from '../test-support/packages.js';
import { readOpenapi } from './openapi.js';

const DOC = {
  openapi: '3.1.0',
  info: { title: 'probe', version: '0.1.0' },
  paths: { '/echo': {} },
};
const BUILD = { commit: SHA, buildTime: '2026-11-05T10:00:00Z' };

let served: Served | undefined;
let server: Server | undefined;
afterEach(async () => {
  await served?.close();
  server?.close();
  served = undefined;
  server = undefined;
  vi.restoreAllMocks();
});

describe('readOpenapi', () => {
  it('is null without openapi.json and the document when it is OpenAPI 3.1', async () => {
    expect(await readOpenapi(await tempPackage({}))).toBeNull();
    expect(await readOpenapi(await tempPackage({ 'openapi.json': json(DOC) }))).toEqual(DOC);
  });

  it('refuses another version, a document without paths and a file that is not JSON', async () => {
    const refused = 'openapi.json is not an OpenAPI 3.1 document';
    const doc = (value: unknown) => tempPackage({ 'openapi.json': json(value) });
    await expect(readOpenapi(await doc({ ...DOC, openapi: '3.0.3' }))).rejects.toThrow(refused);
    await expect(readOpenapi(await doc({ openapi: '3.1.0' }))).rejects.toThrow(refused);
    const text = await tempPackage({ 'openapi.json': '{ nope' });
    await expect(readOpenapi(text)).rejects.toThrow(/openapi\.json is not valid JSON/);
  });
});

describe('the api serves its openapi document', () => {
  it('bare JSON at /api/v1/openapi.json with open CORS, beside the routes', async () => {
    const router = Router().get('/echo', (_req, res) => void res.json({ success: true, data: 1 }));
    const app = createApiApp({
      pkg: API_MANIFEST,
      build: BUILD,
      log: recordedLog().log,
      router,
      openapi: DOC,
    });
    served = await serveApp(app);
    const res = await fetch(`${served.url}/api/v1/openapi.json`, {
      headers: { origin: 'https://x.io' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual(DOC);
    expect(await (await fetch(`${served.url}/api/v1/echo`)).json()).toEqual({
      success: true,
      data: 1,
    });
  });

  it('answers 404 without a document', async () => {
    const app = createApiApp({
      pkg: API_MANIFEST,
      build: BUILD,
      log: recordedLog().log,
      router: Router(),
    });
    served = await serveApp(app);
    expect((await fetch(`${served.url}/api/v1/openapi.json`)).status).toBe(404);
  });

  it('runPart reads it from the package folder, and refuses to start on an invalid one', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const files = { 'package.json': json(API_MANIFEST), 'openapi.json': json(DOC) };
    const dir = await tempPackage(files);
    const options = {
      part: 'api',
      env: {
        PORT: '0',
        AGENTAGE_ISSUER: 'http://127.0.0.1:9',
        AGENTAGE_AUDIENCE: 'localhost',
        AGENTAGE_ORIGIN: 'http://localhost:4280',
      },
      importModule: async () => ({ create: () => Router() }),
    };
    server = await runPart({ ...options, dir, serve: { signals: [] } });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    expect(await (await fetch(`${url}/api/v1/openapi.json`)).json()).toEqual(DOC);
    const bad = await tempPackage({ ...files, 'openapi.json': json({ openapi: '2.0' }) });
    await expect(runPart({ ...options, dir: bad, serve: { signals: [] } })).rejects.toThrow(
      /OpenAPI 3\.1/
    );
  });
});
