import { describe, expect, it } from 'vitest';
import { agcidOf, isAgcid, uuidv7 } from './agcid.js';
import { currentAgcid } from './current.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('agcid', () => {
  it('mints UUIDv7 with the time in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 3);
    const id = uuidv7(now, Buffer.alloc(10, 0xff));
    expect(id).toMatch(UUID_V7);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(now);
    expect(uuidv7()).not.toBe(uuidv7());
  });

  it('accepts 8-128 chars of [A-Za-z0-9._:-] only', () => {
    expect(isAgcid('0194f2a8-7c1e-7b3a-9d40-5e2f6a1c8b77')).toBe(true);
    expect(isAgcid('run:sync.1')).toBe(true);
    expect(isAgcid('short')).toBe(false);
    expect(isAgcid('has space in it')).toBe(false);
    expect(isAgcid('x'.repeat(129))).toBe(false);
    expect(isAgcid(undefined)).toBe(false);
  });

  it('keeps a valid incoming id and replaces an invalid one', () => {
    expect(agcidOf('keep-this-one')).toBe('keep-this-one');
    expect(agcidOf('bad id')).toMatch(UUID_V7);
    expect(agcidOf(undefined)).toMatch(UUID_V7);
  });

  it('has no current agcid outside a request', () => {
    expect(currentAgcid()).toBeUndefined();
  });
});
