import { describe, expect, it } from 'vitest';
import * as contracts from './contracts/index.js';
import * as kit from './index.js';
import * as tool from './tool/index.js';

// Sealing: an author gets the envelope and test helpers, never the server, port or record.
describe('public surface', () => {
  it('the kit exports what an author writes against', () => {
    expect(Object.keys(kit).sort()).toEqual([
      'DiscoveryDocumentSchema',
      'ERROR_STATUS',
      'ErrorEnvelopeSchema',
      'OkEnvelopeSchema',
      'PageQuerySchema',
      'createTestContext',
      'fail',
      'ok',
      'pageOf',
      'parse',
      'reply',
      'siteFromDir',
      'startTestMcp',
      'startTestServer',
      'versionPage',
    ]);
  });

  it('the tool exports what the cli and the build call', () => {
    expect(Object.keys(tool).sort()).toEqual([
      'KIT_VERSION',
      'PROTOCOL_VERSIONS',
      'PackageSchema',
      'SERVED_KINDS',
      'STORE_KINDS',
      'build',
      'buildLines',
      'canonical',
      'check',
      'checkCli',
      'checkLines',
      'down',
      'imageParts',
      'mcpSnapshot',
      'readManifest',
      'runCommand',
      'token',
      'up',
      'validateManifest',
      'writeContracts',
    ]);
  });

  it('the contracts export the wire schemas clients read', () => {
    expect(Object.keys(contracts).sort()).toEqual([
      'AGCID_HEADER',
      'DiscoveryDocumentSchema',
      'ERROR_CODES',
      'ErrorEnvelopeSchema',
      'ExtensionRecordSchema',
      'HealthSchema',
      'OkEnvelopeSchema',
      'isAgcid',
    ]);
  });
});
