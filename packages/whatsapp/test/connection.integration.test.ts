import { waAuth, waConnections } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { Boom } from '@hapi/boom';
import { DisconnectReason, type BaileysEventMap, type WAMessage } from 'baileys';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  loadAuthStore,
  WhatsAppConnection,
  type ConnectionOptions,
  type SocketLike,
} from '../src/index.ts';

const logger = pino({ level: 'silent' });

/** A stand-in for a Baileys socket that lets the test fire events. */
class FakeSocket {
  handler: ((events: Partial<BaileysEventMap>) => Promise<void>) | undefined;
  ended = false;
  pairingRequests: string[] = [];
  groups: Record<string, { id: string; subject: string }> = {};
  ev = {
    process: (handler: (events: Partial<BaileysEventMap>) => Promise<void>) => {
      this.handler = handler;
      return () => undefined;
    },
  };
  end = () => {
    this.ended = true;
    return Promise.resolve();
  };
  requestPairingCode = (phone: string) => {
    this.pairingRequests.push(phone);
    return Promise.resolve('ABCD1234');
  };
  groupFetchAllParticipating = () => Promise.resolve(this.groups);
  async emit(events: Partial<BaileysEventMap>) {
    await this.handler?.(events);
  }
}

const closed = (statusCode: number): Partial<BaileysEventMap> => ({
  'connection.update': {
    connection: 'close',
    lastDisconnect: { error: new Boom('closed', { statusCode }), date: new Date() },
  },
});

describe.skipIf(!testDatabaseUrl)('WhatsAppConnection', () => {
  let testDb: TestDatabase;
  let sockets: FakeSocket[];
  let scheduled: { fn: () => void; ms: number }[];
  let delivered: WAMessage[][];
  let groupReports: { groups: { jid: string; name: string | null }[]; complete: boolean }[];
  let qrsShown: string[];

  const connection = (overrides: Partial<ConnectionOptions> = {}) =>
    new WhatsAppConnection({
      account: 'scraper',
      db: testDb.database.db,
      logger,
      onMessages: (batch) => {
        delivered.push(batch);
        return Promise.resolve();
      },
      onGroups: (groups, complete) => {
        groupReports.push({ groups, complete });
        return Promise.resolve();
      },
      showQr: (qr) => {
        qrsShown.push(qr);
        return Promise.resolve();
      },
      createSocket: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket as unknown as SocketLike;
      },
      schedule: (fn, ms) => scheduled.push({ fn, ms }),
      random: () => 1,
      ...overrides,
    });

  const status = async () => {
    const [row] = await testDb.database.db.select().from(waConnections);
    return row;
  };
  const runScheduled = async () => {
    const next = scheduled.shift();
    next?.fn();
    await new Promise((resolve) => setTimeout(resolve, 20));
    return next?.ms;
  };
  const last = () => sockets[sockets.length - 1] as FakeSocket;

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
  });
  afterAll(async () => {
    await testDb.drop();
  });
  beforeEach(async () => {
    await testDb.database.pool.query('truncate wa_auth, wa_connections');
    sockets = [];
    scheduled = [];
    delivered = [];
    groupReports = [];
    qrsShown = [];
  });

  it('shows the QR code and records that it is waiting for pairing', async () => {
    const conn = connection();
    await conn.start();
    await last().emit({ 'connection.update': { qr: 'QR-DATA' } });
    expect(qrsShown).toEqual(['QR-DATA']);
    expect(await status()).toMatchObject({ state: 'awaiting_pairing', qr: 'QR-DATA' });
    await expect(conn.healthCheck()).resolves.toBeUndefined();
  });

  it('requests a pairing code once when a pairing phone is configured', async () => {
    const conn = connection({ pairingPhone: '201001234567' });
    await conn.start();
    await last().emit({ 'connection.update': { qr: 'QR1' } });
    await last().emit({ 'connection.update': { qr: 'QR2' } });
    expect(last().pairingRequests).toEqual(['201001234567']);
    expect(qrsShown).toEqual([]);
    expect(await status()).toMatchObject({ state: 'awaiting_pairing', pairingCode: 'ABCD1234' });
  });

  it('on open: records the time, clears the QR and reports every group', async () => {
    const conn = connection();
    await conn.start();
    last().groups = { 'g1@g.us': { id: 'g1@g.us', subject: 'Developers' } };
    await last().emit({ 'connection.update': { qr: 'QR' } });
    await last().emit({ 'connection.update': { connection: 'open' } });
    expect(await status()).toMatchObject({ state: 'open', qr: null });
    expect((await status())?.lastConnectedAt).toBeInstanceOf(Date);
    expect(groupReports).toEqual([
      { groups: [{ jid: 'g1@g.us', name: 'Developers' }], complete: true },
    ]);
  });

  it('reconnects with growing delays and resets them once connected', async () => {
    const conn = connection();
    await conn.start();
    await last().emit(closed(DisconnectReason.connectionLost));
    expect(await status()).toMatchObject({
      state: 'reconnecting',
      lastDisconnectReason: 'connectionLost/timedOut (408)',
    });
    expect(await runScheduled()).toBe(1000);
    await last().emit(closed(DisconnectReason.connectionLost));
    expect(await runScheduled()).toBe(2000);
    await last().emit(closed(DisconnectReason.connectionLost));
    expect(await runScheduled()).toBe(4000);
    expect(sockets).toHaveLength(4);
    await last().emit({ 'connection.update': { connection: 'open' } });
    await last().emit(closed(DisconnectReason.connectionLost));
    expect(await runScheduled()).toBe(1000);
  });

  it('reconnects immediately when WhatsApp asks for a restart after pairing', async () => {
    const conn = connection();
    await conn.start();
    await last().emit(closed(DisconnectReason.restartRequired));
    expect(await runScheduled()).toBe(0);
    expect(sockets).toHaveLength(2);
  });

  it('when logged out: clears the saved keys and starts over with a new QR', async () => {
    const store = await loadAuthStore(testDb.database.db, 'scraper');
    await store.saveCreds();
    const conn = connection();
    await conn.start();
    await last().emit(closed(DisconnectReason.loggedOut));
    expect(await status()).toMatchObject({ state: 'logged_out' });
    expect(await testDb.database.db.select().from(waAuth)).toEqual([]);
    expect(await runScheduled()).toBe(5000);
    await last().emit({ 'connection.update': { qr: 'NEW-QR' } });
    expect(qrsShown).toEqual(['NEW-QR']);
  });

  it('waits a full minute if another session replaced this one', async () => {
    const conn = connection();
    await conn.start();
    await last().emit(closed(DisconnectReason.connectionReplaced));
    expect(await runScheduled()).toBe(60_000);
  });

  it('delivers message batches in order and ignores events from replaced sockets', async () => {
    const conn = connection();
    await conn.start();
    const old = last();
    const batch = (id: string) => ({
      'messages.upsert': { type: 'notify' as const, messages: [{ key: { id } } as WAMessage] },
    });
    await old.emit(batch('A'));
    await old.emit(batch('B'));
    await old.emit(closed(DisconnectReason.connectionLost));
    await runScheduled();
    await old.emit(batch('STALE'));
    await last().emit(batch('C'));
    await conn.stop();
    expect(delivered.map((b) => b[0]?.key.id)).toEqual(['A', 'B', 'C']);
  });

  it('retries storing a batch while the database is unavailable', async () => {
    let failures = 2;
    const conn = connection({
      onMessages: (batch) => {
        if (failures-- > 0) return Promise.reject(new Error('database down'));
        delivered.push(batch);
        return Promise.resolve();
      },
      schedule: (fn) => {
        fn();
      },
    });
    await conn.start();
    await last().emit({
      'messages.upsert': { type: 'notify', messages: [{ key: { id: 'A' } }] },
    });
    await conn.stop();
    expect(delivered.map((b) => b[0]?.key.id)).toEqual(['A']);
  });

  it('becomes unhealthy only after being down for more than 5 minutes', async () => {
    const conn = connection();
    await conn.start();
    await last().emit({ 'connection.update': { connection: 'open' } });
    await expect(conn.healthCheck()).resolves.toBeUndefined();
    const realNow = Date.now;
    await last().emit(closed(DisconnectReason.connectionLost));
    await expect(conn.healthCheck()).resolves.toBeUndefined();
    Date.now = () => realNow() + 6 * 60_000;
    try {
      await expect(conn.healthCheck()).rejects.toThrow(/reconnecting for 6 min/);
    } finally {
      Date.now = realNow;
    }
  });

  it('stop() closes the socket and records the stopped state', async () => {
    const conn = connection();
    await conn.start();
    const socket = last();
    await conn.stop();
    expect(socket.ended).toBe(true);
    expect(await status()).toMatchObject({ state: 'stopped' });
  });
});

describe.skipIf(!testDatabaseUrl)('loadAuthStore', () => {
  let testDb: TestDatabase;
  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
  });
  afterAll(async () => {
    await testDb.drop();
  });

  it('keeps credentials and binary keys across restarts', async () => {
    const first = await loadAuthStore(testDb.database.db, 'scraper');
    await first.saveCreds();
    await first.state.keys.set({
      session: { 'peer.0': new Uint8Array([1, 2, 3, 250]) },
      'pre-key': { '1': { public: new Uint8Array([9]), private: new Uint8Array([8]) } },
    });

    const second = await loadAuthStore(testDb.database.db, 'scraper');
    expect(Buffer.from(second.state.creds.noiseKey.public)).toEqual(
      Buffer.from(first.state.creds.noiseKey.public),
    );
    expect(second.state.creds.registrationId).toBe(first.state.creds.registrationId);
    const sessions = await second.state.keys.get('session', ['peer.0', 'missing']);
    expect(Buffer.from(sessions['peer.0'] ?? [])).toEqual(Buffer.from([1, 2, 3, 250]));
    expect(sessions.missing).toBeUndefined();
    const preKeys = await second.state.keys.get('pre-key', ['1']);
    expect(Buffer.from(preKeys['1']?.public ?? [])).toEqual(Buffer.from([9]));
  });

  it('deletes keys set to null, and keeps accounts separate', async () => {
    const scraper = await loadAuthStore(testDb.database.db, 'scraper');
    const bot = await loadAuthStore(testDb.database.db, 'query-bot');
    await bot.state.keys.set({ session: { x: new Uint8Array([1]) } });
    await scraper.state.keys.set({ session: { x: new Uint8Array([2]) } });
    await scraper.state.keys.set({ session: { x: null } });
    expect(await scraper.state.keys.get('session', ['x'])).toEqual({});
    expect(Buffer.from((await bot.state.keys.get('session', ['x'])).x ?? [])).toEqual(
      Buffer.from([1]),
    );
    await bot.clear();
    expect(await bot.state.keys.get('session', ['x'])).toEqual({});
  });
});
