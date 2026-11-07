import { z } from 'zod';
import {
  CommandNameSchema,
  ExtensionIdSchema,
  FIRST_PARTY_IDS,
  PackageNameSchema,
  PackagePathSchema,
  SecretNameSchema,
  SemverRangeSchema,
  SettingKeySchema,
  StoreKindSchema,
  VersionSchema,
} from './primitives.schema.js';

const CodePartSchema = z.union([
  z.boolean(),
  z.strictObject({ entry: PackagePathSchema.optional() }),
]);

const StorePartSchema = z.union([StoreKindSchema, z.strictObject({ kind: StoreKindSchema })], {
  error: `one of ${StoreKindSchema.options.join(', ')}`,
});

const ROUTED = ['pages', 'ui', 'api', 'mcp'] as const;

const PartsSchema = z
  .strictObject({
    pages: CodePartSchema.optional(),
    ui: CodePartSchema.optional(),
    api: CodePartSchema.optional(),
    mcp: CodePartSchema.optional(),
    worker: CodePartSchema.optional(),
    cli: CodePartSchema.optional(),
    store: StorePartSchema.optional(),
  })
  .refine((parts) => ROUTED.some((kind) => isOn(parts[kind])), {
    message: 'at least one routed part (pages, ui, api or mcp)',
  });

const ArgTypeSchema = z.enum(['string', 'integer', 'number', 'boolean']);

const CommandSchema = z.strictObject({
  name: CommandNameSchema,
  summary: z.string().min(1).max(120),
  args: z
    .array(
      z.strictObject({
        name: CommandNameSchema,
        type: ArgTypeSchema,
        required: z.boolean().optional(),
        description: z.string().min(1).max(200).optional(),
      })
    )
    .optional(),
});

const SettingSchema = z
  .strictObject({
    type: ArgTypeSchema,
    default: z.union([z.string(), z.number(), z.boolean()]),
    enum: z.array(z.string()).min(1).optional(),
    description: z.string().min(1).max(200).optional(),
  })
  .refine((setting) => defaultFits(setting.type, setting.default), {
    message: 'default does not match type',
  })
  .refine((setting) => !setting.enum || setting.enum.includes(String(setting.default)), {
    message: 'default is not one of enum',
  });

const AgentageBaseSchema = z.strictObject({
  id: ExtensionIdSchema,
  parts: PartsSchema,
  commands: z.array(CommandSchema).min(1).optional(),
  settings: z.record(SettingKeySchema, SettingSchema).optional(),
  secrets: z.array(SecretNameSchema).optional(),
});

const AgentageSchema = AgentageBaseSchema.superRefine(crossFieldRules);

export const PackageSchema = z
  .looseObject({
    name: PackageNameSchema,
    version: VersionSchema,
    engines: z.looseObject({ agentage: SemverRangeSchema }),
    agentage: AgentageSchema,
  })
  .refine((pkg) => !isFirstParty(pkg.agentage.id) || pkg.name.startsWith('@agentage/'), {
    message: 'a first-party id is claimed only by an @agentage/ package',
    path: ['name'],
  });

export type CodePart = z.infer<typeof CodePartSchema>;
export type CommandSpec = z.infer<typeof CommandSchema>;
export type Parts = z.infer<typeof PartsSchema>;
export type ExtensionPackage = z.infer<typeof PackageSchema>;

function isOn(part: CodePart | undefined): boolean {
  return part !== undefined && part !== false;
}

function isFirstParty(id: string): boolean {
  return (FIRST_PARTY_IDS as readonly string[]).includes(id);
}

function defaultFits(type: z.infer<typeof ArgTypeSchema>, value: unknown): boolean {
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}

function crossFieldRules(manifest: z.infer<typeof AgentageBaseSchema>, ctx: z.RefinementCtx): void {
  const issue = (message: string, path: PropertyKey[]): void =>
    ctx.addIssue({ code: 'custom', message, path });
  const hasCli = isOn(manifest.parts.cli);
  if (manifest.commands && !hasCli) issue('commands need the cli part', ['commands']);
  if (hasCli && !manifest.commands) issue('the cli part needs commands', ['parts', 'cli']);
  const names = (manifest.commands ?? []).map((command) => command.name);
  if (new Set(names).size !== names.length) issue('command names must be unique', ['commands']);
  if (manifest.settings?.['mcp.listing'] && !isOn(manifest.parts.mcp)) {
    issue('mcp.listing needs the mcp part', ['settings', 'mcp.listing']);
  }
}
