import { EventSchema, type Event } from './event.schema.js';

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

// A line that is not a valid event is kept whole as a raw log row.
export const parseLine = (text: string, source: LineSource = {}): Event => {
  const line = text.trim();
  const parsed = EventSchema.safeParse(jsonOf(line));
  if (parsed.success) return parsed.data;
  return EventSchema.parse({
    ts: new Date().toISOString(),
    level: RAW_ERROR.test(line) ? 'error' : 'info',
    kind: 'log',
    msg: line.slice(0, 2000),
    extension: source.extension ?? 'unknown',
    part: source.part ?? 'unknown',
    fields: { 'agentage.raw': true },
  });
};
