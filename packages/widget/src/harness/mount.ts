import * as z from 'zod/mini';
import { type FetchLike } from '../host/host.types.js';
import { WidgetNameSchema } from '../register/names.js';

const WidgetsSchema = z.array(
  z.object({
    name: WidgetNameSchema,
    element: z.string().check(z.regex(/^[a-z][a-z0-9]*(-[a-z0-9-]+)+$/)),
    module: z.string(),
  })
);

export type WidgetList = z.infer<typeof WidgetsSchema>;

export const loadWidgets = async (fetchFn: FetchLike, url: string): Promise<WidgetList> => {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`widgets.json answered ${res.status}`);
  return WidgetsSchema.parse(await res.json());
};

export const pickWidgets = (list: WidgetList, only?: string): WidgetList => {
  if (!only) return list;
  const picked = list.filter((widget) => widget.name === only);
  if (picked.length === 0) throw new Error(`no widget named ${only}`);
  return picked;
};

const create = (doc: Document, element: string, theme?: string): HTMLElement => {
  const el = doc.createElement(element);
  if (theme) el.setAttribute('data-theme', theme);
  return el;
};

export const mountWidgets = (target: Element, list: WidgetList, theme?: string): HTMLElement[] =>
  list.map((widget) => target.appendChild(create(target.ownerDocument, widget.element, theme)));

export const showProblem = (target: Element, message: string): void => {
  const box = target.ownerDocument.createElement('p');
  box.setAttribute('role', 'alert');
  box.textContent = message;
  target.append(box);
};
