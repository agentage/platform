import { type FetchLike, type TokenSource } from '@agentage/widget';
import { send, trimSlash, type ReadOptions } from './http.js';
import {
  InstallationEnvelope,
  OverlayEnvelope,
  type Installation,
  type Overlay,
} from './installation.schema.js';

export type { ReadOptions, ShellError } from './http.js';

export interface WriteOptions {
  token: TokenSource;
  ifMatch: string;
  fetch?: FetchLike;
}

const installationUrl = (rootUrl: string, target: string) =>
  `${trimSlash(rootUrl)}/api/v1/installations/${encodeURIComponent(target)}`;

// Root's GET /api/v1/installations/{target}, with the ETag a later PUT sends as If-Match.
export const readInstallation = async (
  rootUrl: string,
  target: string,
  options: ReadOptions = {}
): Promise<{ installation: Installation; etag?: string }> => {
  const { body, etag } = await send(installationUrl(rootUrl, target), options);
  return { installation: InstallationEnvelope.parse(body).data, etag };
};

// The caller's own route changes on that target: GET PUT .../{target}/overlay.
export const readOverlay = async (
  rootUrl: string,
  target: string,
  options: ReadOptions & { token: TokenSource }
): Promise<{ overlay: Overlay; etag?: string }> => {
  const { body, etag } = await send(`${installationUrl(rootUrl, target)}/overlay`, options);
  return { overlay: OverlayEnvelope.parse(body).data, etag };
};

export const writeOverlay = async (
  rootUrl: string,
  target: string,
  overlay: Overlay,
  options: WriteOptions
): Promise<{ overlay: Overlay; etag?: string }> => {
  const url = `${installationUrl(rootUrl, target)}/overlay`;
  const { body, etag } = await send(url, { ...options, method: 'PUT', body: overlay });
  return { overlay: OverlayEnvelope.parse(body).data, etag };
};
