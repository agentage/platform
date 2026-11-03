import { describe, expect, it } from 'vitest';
import { API_MANIFEST, SHA } from '../test-support/packages.js';
import { labelsOf } from './labels.js';

const BUILD = { commit: SHA, buildTime: '2026-11-03T20:00:00Z' };

describe('image labels', () => {
  it('carry the full sha and build time, and the source from either repository form', () => {
    const repo = { type: 'git', url: 'git+https://github.com/agentage/extension-probe.git' };
    const labels = labelsOf({ ...API_MANIFEST, repository: repo }, 'api', BUILD);
    expect(labels).toMatchObject({
      'org.opencontainers.image.revision': SHA,
      'org.opencontainers.image.created': '2026-11-03T20:00:00Z',
      'org.opencontainers.image.source': 'https://github.com/agentage/extension-probe',
      'io.agentage.part': 'api',
    });
    expect(labelsOf(API_MANIFEST, 'api', BUILD)).not.toHaveProperty(
      'org.opencontainers.image.source'
    );
  });
});
