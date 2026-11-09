import { type Fields } from './event.schema.js';
import { typeOf, type Row } from './rows.js';

const FRAME = /\(?([^\s()]+):(\d+):\d+\)?$/;

// The first frame outside node internals and node_modules, as file:line.
export const frameOf = (stack: string): string | undefined => {
  for (const line of stack.split('\n').slice(1)) {
    const [, file, row] = FRAME.exec(line.trim()) ?? [];
    if (file && !/node_modules|^node:/.test(file))
      return `${file.replace(/^file:\/\//, '')}:${row}`;
  }
  return undefined;
};

const rootCause = (err: Error): string | undefined => {
  let cause: unknown = err.cause;
  let message: string | undefined;
  for (let hops = 0; cause instanceof Error && hops < 5; hops++) {
    message = cause.message;
    cause = cause.cause;
  }
  return message;
};

const exceptionOf = (err: unknown): Fields => {
  if (!(err instanceof Error))
    return { 'exception.type': 'Error', 'exception.message': String(err) };
  const frame = frameOf(err.stack ?? '');
  const cause = rootCause(err);
  return {
    'exception.type': typeOf(err),
    'exception.message': err.message,
    'exception.stacktrace': err.stack ?? '',
    ...(frame ? { 'agentage.frame': frame } : {}),
    ...(cause ? { 'agentage.cause': cause } : {}),
  };
};

// where: the route, tool or job; fields from a caller may carry agentage.fingerprint as an override.
export const errorRow = (err: unknown, where?: string | Fields): Row => {
  const own = typeof where === 'string' ? { 'agentage.where': where } : (where ?? {});
  const exception = exceptionOf(err);
  const type = String(exception['exception.type']);
  const fingerprint =
    own['agentage.fingerprint'] ?? `${type}@${String(exception['agentage.frame'] ?? '?')}`;
  const msg = `${type}: ${String(exception['exception.message'])}`;
  return {
    kind: 'error',
    level: 'error',
    msg,
    fields: { ...exception, ...own, 'agentage.fingerprint': fingerprint },
  };
};
