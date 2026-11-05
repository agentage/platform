import { type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { Router } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { API_MANIFEST, DIGEST, json, SHA, tempPackage } from '../test-support/packages.js';
import { createOf } from '../manifest/entry.js';
import { buildInfoFromEnv, portFromEnv } from './build-info.js';
import { runPart } from './run-part.js';

const echoModule = {
  create: () => {
    const router = Router();
    router.get(
      '/echo',
      (req, res) => void res.json({ success: true, data: { msg: req.query['msg'] } })
    );
    return router;
  },
};

let server: Server | undefined;
afterEach(() => server?.close());

const portOf = (s: Server): number => (s.address() as AddressInfo).port;

describe('runPart', () => {
  it('serves the api part with the image build info and the mounted record', async () => {
    const image = `ghcr.io/agentage/probe-api@${DIGEST}`;
    const record = {
      id: 'probe',
      version: '0.1.0',
      commit: SHA,
      buildTime: '2026-11-03T20:00:00Z',
    };
    const dir = await tempPackage({
      'package.json': json(API_MANIFEST),
      'record.json': json({ ...record, parts: { api: { image } } }),
    });
    const env = {
      PORT: '0',
      COMMIT_SHA: SHA,
      BUILD_TIME: '2026-11-03T20:00:00Z',
      AGENTAGE_RECORD_FILE: `${dir}/record.json`,
      AGENTAGE_ORIGIN: 'https://probe.next.agentage.io',
    };
    server = await runPart({
      dir,
      part: 'api',
      env,
      importModule: async () => echoModule,
      serve: { signals: [] },
    });
    const base = `http://127.0.0.1:${portOf(server)}`;
    const health = (await (await fetch(`${base}/health`)).json()) as { data: { commit: string } };
    expect(health.data.commit).toBe(SHA);
    const echo = await (await fetch(`${base}/api/v1/echo?msg=hi`)).json();
    expect(echo).toEqual({ success: true, data: { msg: 'hi' } });
    const doc = await (await fetch(`${base}/.well-known/agentage-extension.json`)).json();
    expect(doc).toMatchObject({
      host: 'https://probe.next.agentage.io',
      parts: { api: { image } },
    });
  });

  it('refuses a part the manifest does not have, and modules without create', async () => {
    const dir = await tempPackage({ 'package.json': json(API_MANIFEST) });
    await expect(runPart({ dir, part: 'mcp', env: {} })).rejects.toThrow(/not an image part/);
    await expect(runPart({ dir, part: 'store', env: {} })).rejects.toThrow(/not an image part/);
    expect(() => createOf({ default: () => null }, 'dist/api/index.js')).toThrow(/create\(ctx\)/);
    expect(() => createOf(null, 'x.js')).toThrow(/create\(ctx\)/);
  });
});

describe('build info from env', () => {
  it('reads COMMIT_SHA and BUILD_TIME, zeros for a bare dev run', () => {
    expect(buildInfoFromEnv({ COMMIT_SHA: SHA, BUILD_TIME: '2026-11-03T20:00:00Z' })).toEqual({
      commit: SHA,
      buildTime: '2026-11-03T20:00:00Z',
    });
    const dev = buildInfoFromEnv({ COMMIT_SHA: 'dev' }, new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    expect(dev).toEqual({ commit: '0'.repeat(40), buildTime: '2026-01-02T03:04:05Z' });
  });

  it('reads PORT, falling back to 3000', () => {
    expect(portFromEnv({ PORT: '8080' })).toBe(8080);
    expect(portFromEnv({})).toBe(3000);
    expect(portFromEnv({ PORT: 'x' })).toBe(3000);
    expect(portFromEnv({ PORT: '0' })).toBe(0);
  });
});
