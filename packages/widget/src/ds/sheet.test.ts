// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { adoptWidgetStyles, registerProperties } from './sheet.js';
import { propertyCss, widgetCss } from './styles.generated.js';

const shadow = (doc: Document = document) =>
  doc.createElement('div').attachShadow({ mode: 'open' });

// The sheets are cached per document, so their text is recorded before the first one is built.
const texts = new WeakMap<CSSStyleSheet, string>();
const replaceSync = CSSStyleSheet.prototype.replaceSync;
vi.spyOn(CSSStyleSheet.prototype, 'replaceSync').mockImplementation(function (
  this: CSSStyleSheet,
  text: string
) {
  texts.set(this, text);
  replaceSync.call(this, text);
});
const cssOf = (sheet: CSSStyleSheet | undefined) => sheet && texts.get(sheet);

describe('the widget sheet', () => {
  // A document of its own: the sheets are cached per document, so no other test's order counts.
  it('adds only the @property block to the document, once, after the page sheets', () => {
    const doc = document.implementation.createHTMLDocument('');
    const page = new CSSStyleSheet();
    doc.adoptedStyleSheets = [page];
    adoptWidgetStyles(shadow(doc));
    adoptWidgetStyles(shadow(doc));
    registerProperties(doc);
    expect(doc.adoptedStyleSheets).toHaveLength(2);
    expect(doc.adoptedStyleSheets[0]).toBe(page);
    expect(cssOf(doc.adoptedStyleSheets[1])).toBe(propertyCss);
  });

  it('adopts one shared sheet into each shadow root, once per root', () => {
    const [a, b] = [shadow(), shadow()];
    adoptWidgetStyles(a);
    adoptWidgetStyles(a);
    adoptWidgetStyles(b);
    expect(a.adoptedStyleSheets).toHaveLength(1);
    expect(a.adoptedStyleSheets[0]).toBe(b.adoptedStyleSheets[0]);
    expect(cssOf(a.adoptedStyleSheets[0])).toBe(widgetCss);
  });
});

describe('the compiled css', () => {
  it('keeps @property out of the shadow sheet and only @property in the document block', () => {
    expect(widgetCss).not.toContain('@property');
    expect(propertyCss.match(/@property --tw-border-style/g)).toHaveLength(1);
    expect(propertyCss.replace(/@property --[\w-]+\{[^}]*\}/g, '')).toBe('');
  });

  it('matches :host wherever it matches :root', () => {
    const selectors = widgetCss.match(/[^{}]*:root[^{]*\{/g) ?? [];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector).toContain(':host');
    expect(widgetCss).not.toMatch(/html\[data-theme/);
  });

  it('is dark by default and light under prefers-color-scheme on :host', () => {
    expect(widgetCss).toMatch(/:root,:host\{[^}]*--color-background:oklch\(8\.5% \.013 277\)/);
    expect(widgetCss).toMatch(
      /@media \(prefers-color-scheme:light\)\{:host\{color-scheme:light;--color-background:oklch\(100% 0 0\)/
    );
  });

  it('carries the utilities Button and Card use', () => {
    for (const utility of ['.bg-primary{', '.bg-card{', '.rounded-xl{', '.shadow-sm{', '.h-7{'])
      expect(widgetCss).toContain(utility);
  });
});
