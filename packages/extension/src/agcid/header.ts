export const AGCID_HEADER = 'agcid';

export const AGCID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export const isAgcid = (value: unknown): value is string =>
  typeof value === 'string' && AGCID_PATTERN.test(value);
