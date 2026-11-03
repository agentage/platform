import { fail, type ErrorDetail } from './envelope.js';

interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

export interface ParseSchema<T> {
  safeParse(
    value: unknown
  ): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
}

const detailsOf = (issues: readonly Issue[]): ErrorDetail[] =>
  issues.map((issue) => ({
    field: issue.path.map((segment) => String(segment)).join('.') || '(root)',
    message: issue.message,
  }));

// Structural over Zod's safeParse, so an author's own zod copy works with the kit's.
export const parse = <T>(
  schema: ParseSchema<T>,
  value: unknown,
  message = 'Invalid request'
): T => {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw fail('VALIDATION_ERROR', message, { details: detailsOf(result.error.issues) });
};
