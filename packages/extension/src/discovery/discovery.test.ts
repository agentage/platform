import { describe, expect, it } from 'vitest';
import {
  API_MANIFEST,
  DIGEST,
  json,
  SHA,
  SPEC_MANIFEST,
  tempPackage,
} from '../test-support/packages.js';
import { validateManifest } from '../manifest/read-manifest.js';
import { discoveryDocument, loadRecord, recordOf, validateRecord } from './discovery.js';
import { DiscoveryDocumentSchema, ExtensionRecordSchema } from './discovery.schema.js';

const BUILD = { commit: SHA, buildTime: '2026-11-03T20:00:00Z' };
const API_IMAGE = `ghcr.io/agentage/probe-api@${DIGEST}`;

describe('build record', () => {
  it('is built from the manifest, the build and the digests', () => {
    expect(recordOf(API_MANIFEST, BUILD, { api: API_IMAGE })).toEqual({
      id: 'probe',
      version: '0.1.0',
      commit: SHA,
      buildTime: '2026-11-03T20:00:00Z',
      parts: { api: { image: API_IMAGE } },
    });
  });

  it('carries the store kind and command names of the full probe', () => {
    const record = recordOf(validateManifest(SPEC_MANIFEST), BUILD, { api: API_IMAGE });
    expect(record.parts.store).toEqual({ kind: 'postgres' });
    expect(record.commands).toEqual(['ping']);
    expect(ExtensionRecordSchema.safeParse(record).success).toBe(true);
  });

  it('carries the declared secret names for the estate, absent when none, never in discovery', () => {
    const agentage = { ...API_MANIFEST.agentage, secrets: ['github-read'] };
    const record = validateRecord(
      recordOf({ ...API_MANIFEST, agentage }, BUILD, { api: API_IMAGE })
    );
    expect(record.secrets).toEqual(['github-read']);
    const none = { ...API_MANIFEST, agentage: { ...agentage, secrets: [] } };
    expect(recordOf(none, BUILD, { api: API_IMAGE })).not.toHaveProperty('secrets');
    const doc = discoveryDocument(record, 'https://probe.next.agentage.io');
    expect(doc).not.toHaveProperty('secrets');
    expect(DiscoveryDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('lists the parts of a scoped secret for the estate, and discovery shows neither', () => {
    const secrets = ['resend', { name: 'app-key', parts: ['api'] }];
    const pkg = validateManifest({
      ...API_MANIFEST,
      agentage: { ...API_MANIFEST.agentage, secrets },
    });
    const record = validateRecord(recordOf(pkg, BUILD, { api: API_IMAGE }));
    expect(record.secrets).toEqual(['resend', 'app-key']);
    expect(record.secretParts).toEqual({ 'app-key': ['api'] });
    const plain = { ...API_MANIFEST, agentage: { ...API_MANIFEST.agentage, secrets: ['resend'] } };
    expect(recordOf(plain, BUILD, { api: API_IMAGE })).not.toHaveProperty('secretParts');
    const doc = discoveryDocument(record, 'https://probe.next.agentage.io');
    expect(Object.keys(doc).filter((key) => key.startsWith('secret'))).toEqual([]);
    expect(DiscoveryDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('refuses images by tag, a short commit and an image of another extension', () => {
    const tag = recordOf(API_MANIFEST, BUILD, { api: 'ghcr.io/agentage/probe-api:0.1.0' });
    expect(() => validateRecord(tag)).toThrow(/parts\.api\.image/);
    const short = recordOf(API_MANIFEST, { ...BUILD, commit: '9f2c3e1' }, { api: API_IMAGE });
    expect(() => validateRecord(short)).toThrow(/commit/);
    const other = { api: `ghcr.io/agentage/memory-api@${DIGEST}` };
    expect(() => validateRecord(recordOf(API_MANIFEST, BUILD, other))).toThrow(/\{id\}-\{part\}/);
  });
});

describe('discovery document', () => {
  it('is the record plus the host, in the order of the spec', () => {
    const record = validateRecord(recordOf(API_MANIFEST, BUILD, { api: API_IMAGE }));
    const doc = discoveryDocument(record, 'https://probe.next.agentage.io');
    expect(Object.keys(doc)).toEqual(['id', 'version', 'commit', 'buildTime', 'host', 'parts']);
    expect(doc).toEqual({ ...record, host: 'https://probe.next.agentage.io' });
    expect(DiscoveryDocumentSchema.safeParse(doc).success).toBe(true);
  });

  it('takes an https host or a loopback one, nothing else', () => {
    const record = validateRecord(recordOf(API_MANIFEST, BUILD, { api: API_IMAGE }));
    const valid = (host: string) =>
      DiscoveryDocumentSchema.safeParse(discoveryDocument(record, host)).success;
    expect(valid('http://127.0.0.1:3000')).toBe(true);
    expect(valid('http://probe.next.agentage.io')).toBe(false);
    expect(valid('https://probe.next.agentage.io/')).toBe(false);
  });
});

describe('loadRecord', () => {
  it('is null when no record is mounted', async () => {
    await expect(loadRecord('/nonexistent/agentage-extension.json')).resolves.toBeNull();
  });

  it('reads a valid record and refuses an invalid one', async () => {
    const record = recordOf(API_MANIFEST, BUILD, { api: API_IMAGE });
    const dir = await tempPackage({ 'good.json': json(record), 'bad.json': json({ id: 'x' }) });
    await expect(loadRecord(`${dir}/good.json`)).resolves.toEqual(record);
    await expect(loadRecord(`${dir}/bad.json`)).rejects.toThrow(/invalid extension record/);
  });

  it('fails on a record it cannot read, instead of serving the image by tag', async () => {
    const dir = await tempPackage({ 'record.json/x': '' });
    await expect(loadRecord(`${dir}/record.json`)).rejects.toThrow(/EISDIR/);
  });
});

describe('tools in the record (C8)', () => {
  it('are objects naming the scope tools/call needs, or public', () => {
    const record = recordOf(API_MANIFEST, BUILD, { api: API_IMAGE });
    const valid = (tools: unknown) => ExtensionRecordSchema.safeParse({ ...record, tools }).success;
    expect(valid([{ name: 'probe__echo', scope: 'probe:read' }])).toBe(true);
    expect(valid([{ name: 'probe__time', scope: 'public' }])).toBe(true);
    for (const tools of [
      ['probe__echo'],
      [{ name: 'probe__echo' }],
      [{ name: 'probe__echo', scope: 'read' }],
    ])
      expect(valid(tools), JSON.stringify(tools)).toBe(false);
  });
});
