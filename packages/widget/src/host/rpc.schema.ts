import * as z from 'zod/mini';

const ErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  agcid: z.optional(z.string()),
});

export const RpcResponseSchema = z.object({
  jsonrpc: z.optional(z.literal('2.0')),
  id: z.optional(z.union([z.string(), z.number(), z.null()])),
  result: z.optional(z.unknown()),
  error: z.optional(z.object({ code: z.number(), message: z.string() })),
});

export const ToolResultSchema = z.object({
  content: z.optional(z.array(z.unknown())),
  structuredContent: z.optional(z.record(z.string(), z.unknown())),
  isError: z.optional(z.boolean()),
});

export const ToolErrorSchema = z.object({ error: ErrorSchema });

export const TextContentSchema = z.object({ type: z.literal('text'), text: z.string() });

export const EnvelopeSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: z.optional(z.unknown()) }),
  z.object({ success: z.literal(false), error: ErrorSchema }),
]);

export type RpcResponse = z.infer<typeof RpcResponseSchema>;
export type ToolResult = z.infer<typeof ToolResultSchema>;
