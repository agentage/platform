import { type ComponentType } from 'react';
import { defineWidget } from './define-widget.js';
import { elementName, ExtensionIdSchema } from './names.js';

export interface RegisterOptions {
  version?: string;
}

// Defines {id}-{name} once per widget; a second bundle of the same id keeps the first definition.
export const registerWidgets = (
  id: string,
  widgets: Record<string, ComponentType>,
  options: RegisterOptions = {}
): void => {
  ExtensionIdSchema.parse(id);
  const version = options.version ?? '0.0.0';
  for (const [key, component] of Object.entries(widgets)) {
    const element = elementName(id, key);
    if (customElements.get(element)) continue;
    customElements.define(element, defineWidget({ id, element, version, component }));
  }
};
