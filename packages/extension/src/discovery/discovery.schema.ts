import { z } from 'zod';
import {
  CommandNameSchema,
  CommitSchema,
  ExtensionIdSchema,
  IMAGE_PART_KINDS,
  PrefixedToolNameSchema,
  StoreKindSchema,
  VersionSchema,
} from '../manifest/primitives.schema.js';

// registry host[:port]/owner/{id}-{part}@sha256: deployed by digest, a version's images never change.
export const ImageDigestRefSchema = z
  .string()
  .max(256)
  .regex(
    /^[a-z0-9][a-z0-9.-]*(:[0-9]{1,5})?\/[a-z0-9][a-z0-9-]*\/[a-z][a-z0-9-]*-(pages|ui|api|mcp|worker)@sha256:[0-9a-f]{64}$/
  );

const PartImageSchema = z.strictObject({ image: ImageDigestRefSchema });

export const PartsRecordSchema = z
  .strictObject({
    pages: PartImageSchema.optional(),
    ui: PartImageSchema.optional(),
    api: PartImageSchema.optional(),
    mcp: PartImageSchema.optional(),
    worker: PartImageSchema.optional(),
    store: z.strictObject({ kind: StoreKindSchema }).optional(),
  })
  .refine((parts) => IMAGE_PART_KINDS.some((kind) => parts[kind] !== undefined), {
    message: 'at least one part with an image',
  });

export const OriginSchema = z
  .string()
  .max(270)
  .regex(
    /^(https:\/\/[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+|http:\/\/(127\.0\.0\.1|localhost))(:[0-9]{1,5})?$/
  );

const WidgetSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  element: z.string().regex(/^[a-z][a-z0-9]*-[a-z0-9-]+$/),
  module: z.string().regex(/^\/ui\/[^/]+\/[^/]+\.m?js$/),
});

const recordShape = {
  id: ExtensionIdSchema,
  version: VersionSchema,
  commit: CommitSchema,
  buildTime: z.iso.datetime(),
  parts: PartsRecordSchema,
  openapi: z
    .string()
    .regex(/^\/api\/v[1-9][0-9]*\/openapi\.json$/)
    .optional(),
  tools: z.array(PrefixedToolNameSchema).min(1).optional(),
  widgets: z.array(WidgetSchema).min(1).optional(),
  commands: z.array(CommandNameSchema).min(1).optional(),
};

const imagesNameTheirExtension = (doc: { id: string; parts: z.infer<typeof PartsRecordSchema> }) =>
  IMAGE_PART_KINDS.every((kind) => {
    const image = doc.parts[kind]?.image;
    return image === undefined || image.includes(`/${doc.id}-${kind}@sha256:`);
  });

const IMAGE_RULE = { message: 'every image is {id}-{part}', path: ['parts'] };

// The build record: written by `build --push` into the package and the release asset; no host.
export const ExtensionRecordSchema = z
  .strictObject(recordShape)
  .refine(imagesNameTheirExtension, IMAGE_RULE);

// What a deployment serves at /.well-known/agentage-extension.json: the record plus its host.
export const DiscoveryDocumentSchema = z
  .strictObject({ ...recordShape, host: OriginSchema })
  .refine(imagesNameTheirExtension, IMAGE_RULE);

export type ExtensionRecord = z.infer<typeof ExtensionRecordSchema>;
export type DiscoveryDocument = z.infer<typeof DiscoveryDocumentSchema>;
