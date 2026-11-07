import { z } from 'zod';

// Platform names and cli verbs, plus Windows device names: an id is a folder name on machines.
const RESERVED_IDS =
  'auth|www|api|sync|mail|mcp|ui|git|setup|status|update|extension|add|remove|help|con|prn|aux|nul|com[0-9]|lpt[0-9]';

export const ExtensionIdSchema = z
  .string()
  .max(32)
  .regex(new RegExp(`^(?!(?:${RESERVED_IDS})$)[a-z][a-z0-9-]*$`), {
    message: 'lowercase id, never a name the platform owns',
  });

export const FIRST_PARTY_IDS = [
  'root',
  'cloud',
  'market',
  'logs',
  'memory',
  'catalog',
  'dashboard',
  'docs',
] as const;

export const PackageNameSchema = z
  .string()
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/);

export const VersionSchema = z
  .string()
  .regex(
    /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/
  );

export const SemverRangeSchema = z
  .string()
  .max(64)
  .regex(/^[0-9xX*^~<>=| .-]+[0-9A-Za-z.-]*$/);

export const CommandNameSchema = z
  .string()
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/);

export const SettingKeySchema = z
  .string()
  .max(64)
  .regex(/^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/);

export const SecretNameSchema = z
  .string()
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/);

export const PackagePathSchema = z
  .string()
  .max(256)
  .regex(/^\.\/[A-Za-z0-9._/-]+$/);

// One row per store kind; `migrations` says whether the api image carries a migrate job.
export const STORE_KINDS = {
  postgres: { migrations: true },
  signoz: { migrations: false },
  git: { migrations: false },
} as const;

// The kinds the estate serves today; bumped with the estate.
export const SERVED_KINDS: readonly StoreKind[] = ['postgres', 'signoz'];

const KIND_NAMES = Object.keys(STORE_KINDS) as [StoreKind, ...StoreKind[]];

export const StoreKindSchema = z.enum(KIND_NAMES);

export const STORE_KIND_ERROR = `one of ${KIND_NAMES.join(', ')}`;

export const FULL_SHA = /^[0-9a-f]{40}$/;

export const CommitSchema = z.string().regex(FULL_SHA, { message: 'full 40-hex git sha' });

export const PrefixedToolNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9-]*__[a-z][a-z0-9_-]*$/);

export const IMAGE_PART_KINDS = ['pages', 'ui', 'api', 'mcp', 'worker'] as const;

export type ImagePartKind = (typeof IMAGE_PART_KINDS)[number];

export type StoreKind = keyof typeof STORE_KINDS;
