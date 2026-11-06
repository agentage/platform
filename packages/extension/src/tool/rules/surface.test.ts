import { describe, expect, it } from 'vitest';
import { linkModules } from '../../test-support/http.js';
import { API_MANIFEST, json, tempPackage } from '../../test-support/packages.js';
import { check } from '../check.js';
import { surface } from './surface.js';

const API = `import { Router } from 'express';
export const create = () => {
  const router = Router();
  router.get('/items/:id', (_req, res) => res.json({}));
  router.post('/items', (_req, res) => res.json({}));
  return router;
};
`;

const MCP = `import { z } from 'zod';
export const create = (ctx) =>
  ctx.tool('echo', { description: 'Echo', input: z.object({ msg: z.string() }), output: z.object({}) }, () => ({}));
`;

const SCHEMA = 'https://json-schema.org/draft/2020-12/schema';
const ECHO = {
  name: 'probe__echo',
  description: 'Echo',
  inputSchema: {
    $schema: SCHEMA,
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg'],
  },
  outputSchema: { $schema: SCHEMA, type: 'object', properties: {}, additionalProperties: false },
};

const read = { get: { security: [{ pat: ['probe:read'] }] } };
const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'probe', version: '0.1.0' },
  paths: { '/api/v1/items/{id}': read, '/api/v1/items': { post: { security: [] } } },
};

const surfaceOf = async (files: Record<string, string>, parts: object = { api: true }) => {
  const manifest = { ...API_MANIFEST, agentage: { id: 'probe', parts } };
  const dir = await tempPackage({ 'package.json': json(manifest), ...files });
  await linkModules(dir);
  return (await check(dir, { rules: [surface] })).problems.map((p) => `${p.file} ${p.problem}`);
};

describe('surface, the api part', () => {
  it('passes when openapi.json documents exactly the routes, each with its access', async () => {
    expect(await surfaceOf({ 'dist/api/index.js': API, 'openapi.json': json(OPENAPI) })).toEqual(
      []
    );
  });

  it('names each route or version that differs, and an operation without declared access', async () => {
    const stale = {
      ...OPENAPI,
      info: { version: '0.0.9' },
      paths: { '/api/v1/items/{id}': { get: {} }, '/api/v1/gone': read },
    };
    const extra = API.replace('return router;', 'router.use(Router());\n  return router;');
    expect(await surfaceOf({ 'dist/api/index.js': extra, 'openapi.json': json(stale) })).toEqual([
      'openapi.json differs from the generated contract (info.version 0.1.0, POST /api/v1/items, router sub-router, info.version 0.0.9, GET /api/v1/gone)',
      'openapi.json GET /api/v1/items/{id} declares neither a scope nor security: []',
    ]);
  });

  it('reads only the HTTP methods of a path; router.all, an array path, a middleware pass', async () => {
    const pathLevel = {
      parameters: [{ name: 'id', in: 'path' }],
      summary: 's',
      servers: [],
      $ref: '#/x',
    };
    const doc = {
      ...OPENAPI,
      paths: {
        '/api/v1/items/{id}': { ...read, ...pathLevel, description: 'd' },
        '/api/v1/items': { post: { security: [] } },
        '/api/v1/a': read,
        '/api/v1/b': read,
      },
    };
    const code = `import express, { Router } from 'express';
export const create = () => {
  const router = Router();
  router.use(express.json());
  router.get('/items/:id', (_req, res) => res.json({}));
  router.post('/items', (_req, res) => res.json({}));
  router.get(['/a', '/b'], (_req, res) => res.json({}));
  router.all('/any', (_req, res) => res.json({}));
  return router;
};
`;
    expect(await surfaceOf({ 'dist/api/index.js': code, 'openapi.json': json(doc) })).toEqual([]);
  });

  it('reads the routes of an express() app too, and survives a null path item', async () => {
    const app = `import express from 'express';
export const create = () => {
  const app = express();
  app.get('/hidden', (_req, res) => res.json({}));
  return app;
};
`;
    const doc = { ...OPENAPI, paths: { '/api/v1/echo': null } };
    expect(await surfaceOf({ 'dist/api/index.js': app, 'openapi.json': json(doc) })).toEqual([
      'openapi.json differs from the generated contract (GET /api/v1/hidden)',
    ]);
  });

  it('needs the committed contract; leaves a part that does not load to entries', async () => {
    expect(await surfaceOf({ 'dist/api/index.js': API })).toEqual([
      'openapi.json is missing: the api part commits its contract',
    ]);
    expect(await surfaceOf({})).toEqual([]);
  });
});

describe('surface, the mcp part', () => {
  const snapshot = (tools: object[]) =>
    json({ serverInfo: { name: 'agentage-probe', version: '0.1.0' }, tools });

  it('passes when the committed tool list is what the SDK lists for the code', async () => {
    const files = { 'dist/mcp/index.js': MCP, 'probe.mcpc.json': snapshot([ECHO]) };
    expect(await surfaceOf(files, { mcp: true })).toEqual([]);
  });

  it('names each tool that differs, and a missing snapshot', async () => {
    const stale = [
      { ...ECHO, description: 'Old' },
      { ...ECHO, name: 'probe__gone' },
    ];
    const files = { 'dist/mcp/index.js': MCP, 'probe.mcpc.json': snapshot(stale) };
    expect(await surfaceOf(files, { mcp: true })).toEqual([
      'probe.mcpc.json differs from the generated tool list (probe__echo, probe__gone)',
    ]);
    expect(await surfaceOf({ 'dist/mcp/index.js': MCP }, { mcp: true })).toEqual([
      'probe.mcpc.json is missing: the mcp part commits its tool list',
    ]);
  });
});
