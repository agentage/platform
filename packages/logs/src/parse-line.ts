import { EventSchema, type Event, type Fields } from './event.schema.js';
import { cut, redact, scrub } from './redact.js';

const RAW_ERROR = /\b(ERROR|FATAL)\b/;

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export interface LineSource {
  extension?: string;
  part?: string;
}

const isObject = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nameOf = (value: string | undefined): string => cut(value ?? '', 64) || 'unknown';

// Not a valid event: a raw log row, a JSON object keeping its keys; both redacted as the logger does.
export const parseLine = (text: string, source: LineSource = {}): Event => {
  const line = text.trim();
  const json = jsonOf(line);
  const parsed = EventSchema.safeParse(json);
  if (parsed.success)
    return { ...parsed.data, msg: scrub(parsed.data.msg), fields: redact(parsed.data.fields) };
  return EventSchema.parse({
    ts: new Date().toISOString(),
    level: RAW_ERROR.test(line) ? 'error' : 'info',
    kind: 'log',
    msg: scrub(line),
    extension: nameOf(source.extension),
    part: nameOf(source.part),
    fields: { ...(isObject(json) ? redact(json) : {}), 'agentage.raw': true },
  });
};
