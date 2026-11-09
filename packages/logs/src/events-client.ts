import { hostname } from 'node:os';
import { EventSchema, type Event, type EventInput, type Level } from './event.schema.js';
import { uuidv7 } from './uuidv7.js';

export const MAX_BATCH_BYTES = 900_000;
export const MAX_BATCH_ITEMS = 1000;

export interface EventsClientOptions {
  url: string;
  token: string;
  host?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

// What a reporter posts: ts, level, agcid and host are filled when left out.
export type PostEvent = Omit<EventInput, 'ts' | 'level'> & { ts?: string; level?: Level };

export interface PostResult {
  accepted: number;
  rejected: number;
}

const complete = (event: PostEvent, host: string): Event =>
  EventSchema.parse({
    ts: new Date().toISOString(),
    level: 'info',
    agcid: uuidv7(),
    host,
    ...event,
  });

// Each batch under 1 MB and at most 1000 rows (the ingest wire, C3).
export const batchesOf = (events: Event[]): Event[][] => {
  const batches: Event[][] = [];
  let batch: Event[] = [];
  let bytes = 2;
  for (const event of events) {
    const size = Buffer.byteLength(JSON.stringify(event)) + 1;
    if (batch.length > 0 && (bytes + size > MAX_BATCH_BYTES || batch.length >= MAX_BATCH_ITEMS)) {
      batches.push(batch);
      [batch, bytes] = [[], 2];
    }
    batch.push(event);
    bytes += size;
  }
  return batch.length > 0 ? [...batches, batch] : batches;
};

const sendOnce = async (o: EventsClientOptions, body: string): Promise<PostResult> => {
  const res = await (o.fetch ?? fetch)(`${o.url.replace(/\/+$/, '')}/api/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
  });
  if (!res.ok) throw new Error(`POST /api/v1/events answered ${res.status}`);
  const reply = (await res.json()) as { data?: PostResult };
  return reply.data ?? { accepted: 0, rejected: 0 };
};

export const createEventsClient = (o: EventsClientOptions) => ({
  post: async (events: PostEvent[]): Promise<PostResult> => {
    const host = o.host ?? hostname();
    const total: PostResult = { accepted: 0, rejected: 0 };
    for (const batch of batchesOf(events.map((event) => complete(event, host)))) {
      const body = JSON.stringify(batch);
      const result = await sendOnce(o, body).catch(() => sendOnce(o, body));
      total.accepted += result.accepted;
      total.rejected += result.rejected;
    }
    return total;
  },
});
