import { EnvelopeSchema, type Installation } from './installation.schema.js';

export const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export const getJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'omit' });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.json();
};

// Root's GET /api/v1/installations/{target}; until 2.1 a static document of the same shape.
export const readInstallation = async (rootUrl: string, target: string): Promise<Installation> => {
  const url = `${trimSlash(rootUrl)}/api/v1/installations/${encodeURIComponent(target)}`;
  return EnvelopeSchema.parse(await getJson(url)).data;
};
