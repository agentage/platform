import { randomBytes } from 'node:crypto';
import { isAgcid } from './header.js';

export { AGCID_HEADER, AGCID_PATTERN, isAgcid } from './header.js';

const hyphenate = (hex: string): string =>
  [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join(
    '-'
  );

// RFC 9562 UUIDv7: 48-bit unix ms, version 7, variant 10, the rest random.
export const uuidv7 = (now: number = Date.now(), random: Buffer = randomBytes(10)): string => {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(now, 0, 6);
  random.copy(bytes, 6, 0, 10);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  return hyphenate(bytes.toString('hex'));
};

export const agcidOf = (incoming: unknown): string => (isAgcid(incoming) ? incoming : uuidv7());
