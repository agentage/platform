import { type CodePart, type ExtensionPackage, type Parts } from './manifest.schema.js';
import {
  IMAGE_PART_KINDS,
  STORE_KINDS,
  type ImagePartKind,
  type StoreKind,
} from './primitives.schema.js';

export interface NormalizedParts {
  code: Partial<Record<ImagePartKind | 'cli', { entry?: string }>>;
  store?: StoreKind;
}

const normalizeCode = (part: CodePart | undefined): { entry?: string } | undefined => {
  if (part === undefined || part === false) return undefined;
  return part === true ? {} : part;
};

const storeKind = (store: Parts['store']): StoreKind | undefined =>
  typeof store === 'object' ? store.kind : store;

// The manifest accepts `api: true` and `store: "postgres"`; the kit works on one shape.
export const normalizeParts = (parts: Parts): NormalizedParts => {
  const code: NormalizedParts['code'] = {};
  for (const kind of [...IMAGE_PART_KINDS, 'cli'] as const) {
    const normalized = normalizeCode(parts[kind]);
    if (normalized) code[kind] = normalized;
  }
  const store = storeKind(parts.store);
  return store ? { code, store } : { code };
};

export const imageParts = (pkg: ExtensionPackage): ImagePartKind[] => {
  const { code } = normalizeParts(pkg.agentage.parts);
  return IMAGE_PART_KINDS.filter((kind) => code[kind] !== undefined);
};

export const entryOf = (pkg: ExtensionPackage, part: ImagePartKind | 'cli'): string =>
  normalizeParts(pkg.agentage.parts).code[part]?.entry ?? `./dist/${part}/index.js`;

export const storeOf = (pkg: ExtensionPackage): StoreKind | undefined =>
  normalizeParts(pkg.agentage.parts).store;

export const hasStore = (pkg: ExtensionPackage, kind: StoreKind): boolean => storeOf(pkg) === kind;

// The migrate rule: the api image carries migrations/ and a migrate job only for such a kind.
export const migratesStore = (pkg: ExtensionPackage): boolean => {
  const kind = storeOf(pkg);
  return kind !== undefined && STORE_KINDS[kind].migrations;
};
