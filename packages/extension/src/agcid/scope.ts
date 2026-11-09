import { type RequestHandler, type Response } from 'express';
import { whoOf } from '../log/who.js';
import { AGCID_HEADER, agcidOf } from './agcid.js';
import { requestScope, TRACEPARENT_PATTERN } from './current.js';

// Keeps a valid incoming agcid, else mints one; echoed on every response and tags every log line.
export const agcidMiddleware: RequestHandler = (req, res, next) => {
  const traceparent = req.get('traceparent');
  const agcid = agcidOf(req.get(AGCID_HEADER), traceparent);
  res.locals['agcid'] = agcid;
  res.setHeader(AGCID_HEADER, agcid);
  const valid = traceparent !== undefined && TRACEPARENT_PATTERN.test(traceparent);
  const who = whoOf((name) => req.get(name), req.path);
  requestScope.run({ agcid, ...(valid ? { traceparent } : {}), ...who }, next);
};

export const agcidOfResponse = (res: Response): string => {
  const agcid: unknown = res.locals['agcid'];
  return typeof agcid === 'string' ? agcid : agcidOf(undefined);
};
