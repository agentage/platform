import * as z from 'zod/mini';

const KEBAB = /^[a-z][a-z0-9-]*$/;

export const WidgetNameSchema = z
  .string()
  .check(z.maxLength(32), z.regex(KEBAB, 'a widget name is lowercase kebab-case'));

export const ExtensionIdSchema = z
  .string()
  .check(z.maxLength(32), z.regex(KEBAB, 'an extension id is lowercase kebab-case'));

export const kebabCase = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();

export const widgetName = (key: string): string => WidgetNameSchema.parse(kebabCase(key));

export const elementName = (id: string, key: string): string =>
  `${ExtensionIdSchema.parse(id)}-${widgetName(key)}`;
