import { describe, expect, it } from 'vitest';
import { agcidOf, isAgcid, uuidv7 } from './agcid.js';
import { currentAgcid } from './current.js';

const HEX_V7 = /^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/;
const KEEP = '0194f2a87c1e7b3a9d405e2f6a1c8b77';
const TRACE = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';

describe('agcid', () => {
  it('mints UUIDv7 as 32 hex with the time in the first 48 bits', () => {
    const now = Date.UTC(2026, 10, 3);
    const id = uuidv7(now, Buffer.alloc(10, 0xff));
    expect(id).toMatch(HEX_V7);
    expect(parseInt(id.slice(0, 12), 16)).toBe(now);
    expect(uuidv7()).not.toBe(uuidv7());
  });

  it('accepts 32 lowercase hex only', () => {
    expect(isAgcid(KEEP)).toBe(true);
    expect(isAgcid('0194f2a8-7c1e-7b3a-9d40-5e2f6a1c8b77')).toBe(false);
    expect(isAgcid(KEEP.toUpperCase())).toBe(false);
    expect(isAgcid('run:sync.1')).toBe(false);
    expect(isAgcid(undefined)).toBe(false);
  });

  it('keeps the header, then the traceparent trace id, else mints (32 hex)', () => {
    expect(agcidOf(KEEP, TRACE)).toBe(KEEP);
    expect(agcidOf('0194F2A8-7C1E-7B3A-9D40-5E2F6A1C8B77')).toBe(KEEP);
    expect(agcidOf('bad id', TRACE)).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(agcidOf('bad id', 'junk')).toMatch(HEX_V7);
    expect(agcidOf(undefined)).toMatch(HEX_V7);
  });

  it('has no current agcid outside a request', () => {
    expect(currentAgcid()).toBeUndefined();
  });
});
