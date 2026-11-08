import { type RequestHandler, type Response } from 'express';
import { AGCID_HEADER, agcidOf } from './agcid.js';
import { requestScope, TRACEPARENT_PATTERN } from './current.js';

// Keeps a valid incoming agcid, else mints one; echoed on every response and tags every log line.
export const agcidMiddleware: RequestHandler = (req, res, next) => {
  const agcid = agcidOf(req.get(AGCID_HEADER));
  res.locals['agcid'] = agcid;
  res.setHeader(AGCID_HEADER, agcid);
  const traceparent = req.get('traceparent');
  const valid = traceparent !== undefined && TRACEPARENT_PATTERN.test(traceparent);
  requestScope.run(valid ? { agcid, traceparent } : { agcid }, next);
};

export const agcidOfResponse = (res: Response): string => {
  const agcid: unknown = res.locals['agcid'];
  return typeof agcid === 'string' ? agcid : agcidOf(undefined);
};
