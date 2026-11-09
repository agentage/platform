import { EventSchema, type Event, type Fields } from './event.schema.js';
import { MAX_STRING, redact } from './redact.js';

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

// A line that is not a valid event is a raw log row; a JSON object keeps its keys, redacted.
export const parseLine = (text: string, source: LineSource = {}): Event => {
  const line = text.trim();
  const json = jsonOf(line);
  const parsed = EventSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  return EventSchema.parse({
    ts: new Date().toISOString(),
    level: RAW_ERROR.test(line) ? 'error' : 'info',
    kind: 'log',
    msg: line.slice(0, MAX_STRING),
    extension: source.extension ?? 'unknown',
    part: source.part ?? 'unknown',
    fields: { ...(isObject(json) ? redact(json) : {}), 'agentage.raw': true },
  });
};
