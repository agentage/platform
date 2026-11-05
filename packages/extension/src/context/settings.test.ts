import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest/read-manifest.js';
import { recordedLog } from '../test-support/http.js';
import { API_MANIFEST } from '../test-support/packages.js';
import { settingsFromEnv } from './settings.js';

const PKG = validateManifest({
  ...API_MANIFEST,
  agentage: {
    id: 'probe',
    parts: { api: true, mcp: true },
    settings: {
      'mcp.listing': { type: 'string', enum: ['open', 'token'], default: 'open' },
      'tick.every': { type: 'integer', default: 30 },
      ratio: { type: 'number', default: 0.5 },
      verbose: { type: 'boolean', default: false },
    },
  },
});

const DEFAULTS = { 'mcp.listing': 'open', 'tick.every': 30, ratio: 0.5, verbose: false };

const from = (value?: unknown) => {
  const logged = recordedLog();
  const env = value === undefined ? {} : { AGENTAGE_SETTINGS: JSON.stringify(value) };
  return { values: settingsFromEnv(PKG, env, logged.log), lines: logged.lines };
};

describe('settingsFromEnv', () => {
  it('gives the defaults without AGENTAGE_SETTINGS, and none for a manifest without settings', () => {
    expect(from().values).toEqual(DEFAULTS);
    expect(settingsFromEnv(API_MANIFEST, {}, recordedLog().log)).toEqual({});
  });

  it('puts the host values over the defaults', () => {
    const given = { 'mcp.listing': 'token', 'tick.every': 60, ratio: 2, verbose: true };
    expect(from(given).values).toEqual(given);
  });

  it('warns about an undeclared key and ignores it', () => {
    const { values, lines } = from({ extra: 1 });
    expect(values).toEqual(DEFAULTS);
    expect(lines).toEqual([
      expect.objectContaining({
        level: 'warn',
        msg: 'setting not declared in the manifest, ignored',
        setting: 'extra',
      }),
    ]);
  });

  it('stops the start on a wrong type or a value outside the enum', () => {
    expect(() => from({ 'tick.every': 1.5 })).toThrow(
      'setting tick.every: 1.5 does not fit its declaration'
    );
    expect(() => from({ ratio: '2' })).toThrow('setting ratio: "2" does not fit its declaration');
    expect(() => from({ verbose: 'yes' })).toThrow(
      'setting verbose: "yes" does not fit its declaration'
    );
    expect(() => from({ 'mcp.listing': 'closed' })).toThrow(
      'setting mcp.listing: "closed" does not fit its declaration'
    );
  });

  it('refuses AGENTAGE_SETTINGS that is not a JSON object', () => {
    for (const value of [[1], null, 'text', 3]) {
      expect(() => from(value)).toThrow('AGENTAGE_SETTINGS is not a JSON object');
    }
    expect(() => settingsFromEnv(PKG, { AGENTAGE_SETTINGS: '{nope' }, recordedLog().log)).toThrow(
      SyntaxError
    );
  });
});
