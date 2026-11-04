// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { adoptWidgetStyles, registerProperties } from './sheet.js';
import { propertyCss, widgetCss } from './styles.generated.js';

const shadow = () => document.createElement('div').attachShadow({ mode: 'open' });

describe('the widget sheet', () => {
  it('registers the @property block once on the document', () => {
    adoptWidgetStyles(shadow());
    adoptWidgetStyles(shadow());
    registerProperties(document);
    expect(document.adoptedStyleSheets).toHaveLength(1);
  });

  it('adopts one shared sheet into each shadow root, once per root', () => {
    const [a, b] = [shadow(), shadow()];
    adoptWidgetStyles(a);
    adoptWidgetStyles(a);
    adoptWidgetStyles(b);
    expect(a.adoptedStyleSheets).toHaveLength(1);
    expect(a.adoptedStyleSheets[0]).toBe(b.adoptedStyleSheets[0]);
    expect(a.adoptedStyleSheets[0]).not.toBe(document.adoptedStyleSheets[0]);
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
