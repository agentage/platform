import { type Fields } from './event.schema.js';
import { typeOf, type Row } from './rows.js';

const exceptionOf = (err: unknown): Fields =>
  err instanceof Error
    ? {
        'exception.type': typeOf(err),
        'exception.message': err.message,
        'exception.stacktrace': err.stack ?? '',
      }
    : { 'exception.type': 'Error', 'exception.message': String(err) };

// where: the route, tool or job; an author's agentage.fingerprint passes through (Q11 A).
export const errorRow = (err: unknown, where?: string | Fields): Row => {
  const own = typeof where === 'string' ? { 'agentage.where': where } : (where ?? {});
  const exception = exceptionOf(err);
  const msg = `${String(exception['exception.type'])}: ${String(exception['exception.message'])}`;
  return { kind: 'error', level: 'error', msg, fields: { ...exception, ...own } };
};
