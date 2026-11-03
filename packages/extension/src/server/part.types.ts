import { type RequestHandler, type Router } from 'express';
import { type PartContext } from '../context/context.js';

export type ApiHandler = Router | RequestHandler;

export type ApiCreate<C extends PartContext = PartContext> = (
  ctx: C
) => ApiHandler | Promise<ApiHandler>;

// An api part module exports create(ctx) and nothing else.
export interface ApiPart {
  create: ApiCreate;
}
