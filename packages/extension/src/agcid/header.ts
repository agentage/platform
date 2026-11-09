export const AGCID_HEADER = 'agcid';

// A UUIDv7 as 32 lowercase hex, a valid W3C trace id (api-standards section 6).
export const AGCID_PATTERN = /^[0-9a-f]{32}$/;

export const isAgcid = (value: unknown): value is string =>
  typeof value === 'string' && AGCID_PATTERN.test(value);
