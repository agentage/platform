import { hostname } from 'node:os';
import { EventSchema, type Event, type EventInput, type Level } from './event.schema.js';
import { redact } from './redact.js';
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

const complete = (event: PostEvent, host: string): Event => {
  const filled = { ts: new Date().toISOString(), level: 'info', agcid: uuidv7(), host, ...event };
  return EventSchema.parse({ ...filled, fields: redact(event.fields ?? {}) });
};

const sizeOf = (event: Event): number => Buffer.byteLength(JSON.stringify(event)) + 1;

// A row alone over the batch limit would be a 413: it is dropped with a warning instead.
const fitting = (event: Event): boolean => {
  if (sizeOf(event) + 2 <= MAX_BATCH_BYTES) return true;
  process.emitWarning(`@agentage/logs: dropped a ${event.kind} row over 900 KB`);
  return false;
};

// Each batch under 1 MB and at most 1000 rows (the ingest wire, C3).
export const batchesOf = (events: Event[]): Event[][] => {
  const batches: Event[][] = [];
  let batch: Event[] = [];
  let bytes = 2;
  for (const event of events) {
    const size = sizeOf(event);
    if (batch.length > 0 && (bytes + size > MAX_BATCH_BYTES || batch.length >= MAX_BATCH_ITEMS)) {
      batches.push(batch);
      [batch, bytes] = [[], 2];
    }
    batch.push(event);
    bytes += size;
  }
  return batch.length > 0 ? [...batches, batch] : batches;
};

class IngestError extends Error {
  constructor(readonly status: number) {
    super(`POST /api/v1/events answered ${status}`);
  }
}

// A network error, 429 or 5xx is tried once more; a 4xx would fail the same way again.
const retries = (err: unknown): boolean =>
  !(err instanceof IngestError) || err.status === 429 || err.status >= 500;

const sendOnce = async (o: EventsClientOptions, body: string): Promise<PostResult> => {
  const res = await (o.fetch ?? fetch)(`${o.url.replace(/\/+$/, '')}/api/v1/events`, {
    method: 'POST',
    headers: { authorization: `Bearer ${o.token}`, 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(o.timeoutMs ?? 5000),
  });
  if (!res.ok) throw new IngestError(res.status);
  const reply = (await res.json()) as { data?: PostResult };
  return reply.data ?? { accepted: 0, rejected: 0 };
};

const send = (o: EventsClientOptions, body: string): Promise<PostResult> =>
  sendOnce(o, body).catch((err: unknown) => {
    if (!retries(err)) throw err;
    return sendOnce(o, body);
  });

// Posts rows to the ingest; a refused or unreachable ingest rejects: the caller catches.
export const createEventsClient = (o: EventsClientOptions) => ({
  post: async (events: PostEvent[]): Promise<PostResult> => {
    const host = o.host ?? hostname();
    const total: PostResult = { accepted: 0, rejected: 0 };
    const rows = events.map((event) => complete(event, host)).filter(fitting);
    for (const batch of batchesOf(rows)) {
      const result = await send(o, JSON.stringify(batch));
      total.accepted += result.accepted;
      total.rejected += result.rejected;
    }
    return total;
  },
});
