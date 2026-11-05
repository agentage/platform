import { createServer, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFailure } from '../envelope/envelope.js';
import { recordedLog } from '../test-support/http.js';
import { createStore, type PoolStore } from './store.js';

type Answer = (sql: string) => Buffer | undefined;

interface Handlers {
  answer: Answer | undefined;
  startup: (params: Record<string, string>) => void;
  query: (sql: string) => void;
}

interface Session {
  pending: Buffer;
  started: boolean;
}

interface FakePg {
  env: { AGENTAGE_STORE_URL: string };
  startup: Promise<Record<string, string>>;
  queried: Promise<string>;
  close(): Promise<void>;
}

const frame = (type: string, body: Buffer | string): Buffer => {
  const data = Buffer.from(body);
  const head = Buffer.alloc(5);
  head.write(type);
  head.writeInt32BE(data.length + 4, 1);
  return Buffer.concat([head, data]);
};

const READY = frame('Z', 'I');
const HELLO = Buffer.concat([frame('R', Buffer.alloc(4)), READY]);
const errorReply = (code: string, message: string): Buffer =>
  Buffer.concat([frame('E', `SERROR\0C${code}\0M${message}\0\0`), READY]);

// The startup message has no type byte (length first); every later message starts with one.
const take = (s: Session): Buffer | undefined => {
  const at = s.started ? 1 : 0;
  if (s.pending.length < at + 4) return undefined;
  const size = at + s.pending.readInt32BE(at);
  if (s.pending.length < size) return undefined;
  const message = s.pending.subarray(0, size);
  s.pending = s.pending.subarray(size);
  return message;
};

const paramsOf = (startup: Buffer): Record<string, string> => {
  const words = startup.subarray(8).toString().split('\0');
  const pairs = words.flatMap((word, i) => (i % 2 === 0 && word ? [[word, words[i + 1]]] : []));
  return Object.fromEntries(pairs) as Record<string, string>;
};

const reply = (h: Handlers, s: Session, message: Buffer): Buffer | undefined => {
  if (!s.started) {
    s.started = true;
    h.startup(paramsOf(message));
    return h.answer ? HELLO : undefined;
  }
  if (message.toString('latin1', 0, 1) !== 'Q') return undefined;
  const sql = message.subarray(5, -1).toString();
  h.query(sql);
  return h.answer?.(sql);
};

const serve = (socket: Socket, h: Handlers): void => {
  const s: Session = { pending: Buffer.alloc(0), started: false };
  socket.on('error', () => undefined);
  socket.on('data', (chunk) => {
    s.pending = Buffer.concat([s.pending, Buffer.from(chunk)]);
    for (let message = take(s); message; message = take(s)) {
      const out = reply(h, s, message);
      if (out) socket.write(out);
    }
  });
};

// A postgres that trusts anyone; without `answer` it never ends the handshake.
const fakePostgres = async (answer?: Answer): Promise<FakePg> => {
  const startup = Promise.withResolvers<Record<string, string>>();
  const queried = Promise.withResolvers<string>();
  const sockets = new Set<Socket>();
  const handlers: Handlers = { answer, startup: startup.resolve, query: queried.resolve };
  const server = createServer((socket) => void (sockets.add(socket), serve(socket, handlers)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `postgres://u:p@127.0.0.1:${(server.address() as AddressInfo).port}/db`;
  const close = () => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  };
  return {
    env: { AGENTAGE_STORE_URL: url },
    startup: startup.promise,
    queried: queried.promise,
    close,
  };
};

const settle = (promise: Promise<unknown>) => {
  const state = { done: false, value: promise.catch((err: unknown) => err) };
  void state.value.finally(() => {
    state.done = true;
  });
  return state;
};

let pg: FakePg | undefined;
let store: PoolStore | undefined;
afterEach(async () => {
  vi.useRealTimers();
  await store?.end();
  await pg?.close();
  store = undefined;
  pg = undefined;
});

const open = async (answer?: Answer) => {
  pg = await fakePostgres(answer);
  const logged = recordedLog();
  store = createStore(pg.env, logged.log);
  return { pg, store, lines: logged.lines };
};

const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

describe('createStore on the wire', () => {
  it('asks for a 10 s statement timeout and passes a failing query through untouched', async () => {
    const bad = () => errorReply('42601', 'syntax error at or near "selec"');
    const { pg, store, lines } = await open(bad);
    const err = await store.query('selec 1').catch((e: unknown) => e);
    expect(isFailure(err)).toBe(false);
    expect(err).toMatchObject({ code: '42601', message: 'syntax error at or near "selec"' });
    expect(await pg.startup).toMatchObject({
      user: 'u',
      database: 'db',
      statement_timeout: '10000',
    });
    expect(lines).toEqual([]);
  });

  it('a query left unanswered fails 2 s past the statement timeout, as UNAVAILABLE', async () => {
    const { pg, store, lines } = await open(() => undefined);
    fakeClock();
    const result = settle(store.query('select 1'));
    expect(await pg.queried).toBe('select 1');
    await vi.advanceTimersByTimeAsync(11_999);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result.value).toMatchObject({ code: 'UNAVAILABLE', status: 503 });
    expect(lines).toMatchObject([{ level: 'warn', reason: 'Query read timeout' }]);
  });

  it('gives a server that never ends the handshake 5 s, then UNAVAILABLE', async () => {
    const { pg, store, lines } = await open();
    fakeClock();
    const result = settle(store.query('select 1'));
    await pg.startup;
    await vi.advanceTimersByTimeAsync(4_999);
    expect(result.done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result.value).toMatchObject({ code: 'UNAVAILABLE', status: 503 });
    const reason = 'Connection terminated due to connection timeout';
    expect(lines).toMatchObject([{ level: 'warn', msg: 'store unavailable', reason }]);
  });
});
