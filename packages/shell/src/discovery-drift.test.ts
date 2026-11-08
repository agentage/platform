import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ELEMENT, KEBAB, MODULE, ORIGIN } from './installation.schema.js';

// The kit cannot enter a browser bundle, so shell keeps a copy; this fails when the copies part.
const file = '@agentage/extension/schemas/extension-discovery.schema.json';
const kit = JSON.parse(readFileSync(createRequire(import.meta.url).resolve(file), 'utf8'));
const widget = kit.properties.widgets.items.properties;

describe("shell's discovery patterns are the kit's", () => {
  it.each([
    ['host', ORIGIN, kit.properties.host.pattern],
    ['widget name', KEBAB, widget.name.pattern],
    ['widget element', ELEMENT, widget.element.pattern],
    ['widget module', MODULE, widget.module.pattern],
  ])('%s', (_field, shell: RegExp, pattern: string) => {
    expect(shell.source).toBe(pattern);
  });
});
