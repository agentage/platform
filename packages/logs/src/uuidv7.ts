import { randomBytes } from 'node:crypto';

// RFC 9562 UUIDv7 as 32 lowercase hex, a valid W3C trace id: 48-bit ms, version 7, variant 10.
export const uuidv7 = (now: number = Date.now(), random: Buffer = randomBytes(10)): string => {
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(now, 0, 6);
  random.copy(bytes, 6, 0, 10);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  return bytes.toString('hex');
};
