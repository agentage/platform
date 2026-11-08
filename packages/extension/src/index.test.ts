import { describe, expect, it } from 'vitest';
import * as kit from './index.js';
import * as tool from './tool/index.js';

// Sealing: an author gets the envelope, schemas and test helpers, never the server, port or record.
describe('public surface', () => {
  it('the kit exports no server, listener or record loader', () => {
    expect(Object.keys(kit).sort()).toEqual([
      'AGCID_HEADER',
      'DiscoveryDocumentSchema',
      'ERROR_CODES',
      'ERROR_STATUS',
      'ErrorEnvelopeSchema',
      'ExtensionRecordSchema',
      'HealthSchema',
      'OkEnvelopeSchema',
      'PROTOCOL_VERSIONS',
      'PackageSchema',
      'PageQuerySchema',
      'SERVED_KINDS',
      'STORE_KINDS',
      'canonical',
      'createTestContext',
      'fail',
      'imageParts',
      'isAgcid',
      'isFailure',
      'mcpSnapshot',
      'ok',
      'pageOf',
      'parse',
      'readManifest',
      'reply',
      'startTestMcp',
      'startTestServer',
      'validateManifest',
      'versionPage',
    ]);
  });

  it('the tool exports what the cli calls', () => {
    expect(Object.keys(tool).sort()).toEqual([
      'KIT_VERSION',
      'build',
      'buildLines',
      'check',
      'checkCli',
      'checkLines',
      'down',
      'readManifest',
      'runCommand',
      'token',
      'up',
      'validateManifest',
      'writeContracts',
    ]);
  });
});
