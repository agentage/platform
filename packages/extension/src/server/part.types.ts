import { type RequestHandler, type Router } from 'express';
import { type ApiContext } from '../api/routes.js';

export type ApiHandler = Router | RequestHandler;

// Registers its routes with ctx.route and returns nothing, or returns an Express router.
export type ApiCreate<C extends ApiContext = ApiContext> = (
  ctx: C
) => ApiHandler | void | Promise<ApiHandler | void>;

// An api part module exports create(ctx) and nothing else.
export interface ApiPart {
  create: ApiCreate;
}
