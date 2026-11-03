import { AsyncLocalStorage } from 'node:async_hooks';
import { type RequestHandler, type Response } from 'express';
import { AGCID_HEADER, agcidOf } from './agcid.js';

interface RequestScope {
  agcid: string;
}

const scope = new AsyncLocalStorage<RequestScope>();

export const currentAgcid = (): string | undefined => scope.getStore()?.agcid;

// Keeps a valid incoming agcid, else mints one; echoed on every response and tags every log line.
export const agcidMiddleware: RequestHandler = (req, res, next) => {
  const agcid = agcidOf(req.get(AGCID_HEADER));
  res.locals['agcid'] = agcid;
  res.setHeader(AGCID_HEADER, agcid);
  scope.run({ agcid }, next);
};

export const agcidOfResponse = (res: Response): string => {
  const agcid: unknown = res.locals['agcid'];
  return typeof agcid === 'string' ? agcid : agcidOf(undefined);
};
