import { propertyCss, widgetCss } from './styles.generated.js';

const propertySheets = new WeakMap<Document, CSSStyleSheet>();
const widgetSheets = new WeakMap<Document, CSSStyleSheet>();

const sheetOf = (cache: WeakMap<Document, CSSStyleSheet>, doc: Document, css: string) => {
  const cached = cache.get(doc);
  if (cached) return cached;
  const view = doc.defaultView ?? globalThis;
  const sheet = new view.CSSStyleSheet();
  sheet.replaceSync(css);
  cache.set(doc, sheet);
  return sheet;
};

// @property is ignored inside a shadow root, so it is registered once on the document.
export const registerProperties = (doc: Document): void => {
  if (propertySheets.has(doc)) return;
  const sheet = sheetOf(propertySheets, doc, propertyCss);
  doc.adoptedStyleSheets = [...(doc.adoptedStyleSheets ?? []), sheet];
};

// One constructed sheet per document, shared by every widget root that adopts it.
export const adoptWidgetStyles = (root: ShadowRoot): void => {
  const doc = root.ownerDocument;
  registerProperties(doc);
  const sheet = sheetOf(widgetSheets, doc, widgetCss);
  const adopted = root.adoptedStyleSheets ?? [];
  if (!adopted.includes(sheet)) root.adoptedStyleSheets = [...adopted, sheet];
};
