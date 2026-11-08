import { type z } from 'zod';
import { ACCESS, badScope, type Access } from '../auth/token-check.js';
import { type PartContext } from '../context/context.js';

type ObjectSchema = z.ZodObject;

export interface ToolSpec<I extends ObjectSchema, O extends ObjectSchema> {
  description: string;
  input: I;
  output: O;
  // What tools/call needs: {id}:{scope}, or public; read when left out (optional is routes only).
  scope?: Exclude<Access, 'optional'>;
}

export type ToolHandler<I extends ObjectSchema, O extends ObjectSchema> = (
  args: z.output<I>
) => z.input<O> | Promise<z.input<O>>;

// Registers a tool under its own name; the kit serves it as {id}__{name}.
export type ToolRegistrar = <I extends ObjectSchema, O extends ObjectSchema>(
  name: string,
  spec: ToolSpec<I, O>,
  handler: ToolHandler<I, O>
) => void;

export interface McpContext extends PartContext {
  readonly tool: ToolRegistrar;
}

export interface ToolEntry {
  name: string;
  spec: ToolSpec<ObjectSchema, ObjectSchema>;
  handler: (args: Record<string, unknown>) => unknown;
}

const TOOL_NAME = /^[a-z][a-z0-9_-]*$/;
const TOOL_ACCESS = ACCESS.filter((access) => access !== 'optional');

export const createToolRegistry = () => {
  const tools: ToolEntry[] = [];
  const tool: ToolRegistrar = (name, spec, handler) => {
    if (!TOOL_NAME.test(name)) throw new Error(`tool name ${name}: lowercase, digits, _ and -`);
    if (tools.some((entry) => entry.name === name))
      throw new Error(`tool ${name} is registered twice`);
    if (!spec.description) throw new Error(`tool ${name} needs a description: it routes the model`);
    const bad = badScope(spec.scope, TOOL_ACCESS);
    if (bad) throw new Error(`tool ${name} ${bad}`);
    tools.push({ name, spec, handler: handler as ToolEntry['handler'] });
  };
  return { tool, tools };
};

export const prefixed = (id: string, name: string): string => `${id}__${name}`;
