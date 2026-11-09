import { randomBytes } from 'node:crypto';
import { TRACEPARENT_PATTERN } from './current.js';
import { isAgcid } from './header.js';

export { AGCID_HEADER, AGCID_PATTERN, isAgcid } from './header.js';

// RFC 9562 UUIDv7 as 32 lowercase hex, a valid W3C trace id: 48-bit ms, version 7, variant 10.
export const uuidv7 = (now: number = Date.now(), random: Buffer = randomBytes(10)): string => {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(now, 0, 6);
  random.copy(bytes, 6, 0, 10);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  return bytes.toString('hex');
};

const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO = '0'.repeat(32);

// 32 hex, or a UUID in its 8-4-4-4-12 form without the dashes; all zeros is no id (W3C).
const ownOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const lower = value.toLowerCase();
  const id = DASHED.test(lower) ? lower.replaceAll('-', '') : lower;
  return isAgcid(id) && id !== ZERO ? id : undefined;
};

const traceIdOf = (traceparent: unknown): string | undefined =>
  typeof traceparent === 'string' && TRACEPARENT_PATTERN.test(traceparent)
    ? ownOf(traceparent.slice(3, 35))
    : undefined;

// A valid agcid header, else the traceparent trace id, else minted.
export const agcidOf = (incoming: unknown, traceparent?: unknown): string =>
  ownOf(incoming) ?? traceIdOf(traceparent) ?? uuidv7();
