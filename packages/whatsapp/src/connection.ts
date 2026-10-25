import { type Db } from '@reb/db';
import {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type BaileysEventMap,
  type ConnectionState,
  type GroupMetadata,
  type WAMessage,
  type WASocket,
} from 'baileys';
import type { Logger } from 'pino';
import { loadAuthStore } from './auth-store.ts';
import { saveConnectionStatus, type ConnectionStatus } from './status.ts';

/** The parts of a Baileys socket this module uses. Tests pass a fake. */
export type SocketLike = Pick<
  WASocket,
  'ev' | 'end' | 'requestPairingCode' | 'groupFetchAllParticipating'
>;
export type SocketFactory = (config: Parameters<typeof makeWASocket>[0]) => SocketLike;

export interface GroupInfo {
  jid: string;
  name: string | null;
}

export interface ConnectionOptions {
  /** Which WhatsApp number this is: 'scraper' or 'query-bot'. */
  account: string;
  db: Db;
  logger: Logger;
  /** Pair with an 8-character code for this phone number instead of a QR code. */
  pairingPhone?: string | undefined;
  /** Called with every batch of incoming messages, in order. */
  onMessages: (messages: WAMessage[]) => Promise<void>;
  /**
   * Called with group names. `complete` is true when the list holds every
   * group the number is in (so missing groups have been left).
   */
  onGroups: (groups: GroupInfo[], complete: boolean) => Promise<void>;
  /** Shows a pairing QR code to the operator. Defaults to printing it in the logs. */
  showQr?: (qr: string) => Promise<void>;
  createSocket?: SocketFactory;
  /** For tests: replaces setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  /** For tests: replaces Math.random in the backoff jitter. */
  random?: () => number;
}

const MAX_RECONNECT_DELAY_MS = 60_000;
/** How long the connection may stay down before the health check fails. */
export const UNHEALTHY_AFTER_MS = 5 * 60_000;

/**
 * Delay before reconnect attempt number `attempt` (0, 1, 2 ...): 1 s, 2 s,
 * 4 s ... up to 60 s, randomized between 50 % and 100 % of that so many
 * clients don't all reconnect at the same moment.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + random() / 2));
}

/** Readable name for a WhatsApp disconnect status code, e.g. "connectionLost (408)". */
export function describeDisconnect(statusCode: number | undefined): string {
  if (statusCode === undefined) return 'unknown';
  const names = Object.entries(DisconnectReason)
    .filter(([, code]) => Number(code) === statusCode)
    .map(([name]) => name);
  return `${names.join('/') || 'other'} (${statusCode})`;
}

function statusCodeOf(state: Partial<ConnectionState>): number | undefined {
  const error = state.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
  return error?.output?.statusCode;
}

/**
 * Keeps one WhatsApp account connected: pairs it (QR or pairing code),
 * saves its login keys to Postgres, reconnects with backoff when the
 * connection drops, and reports every state change to `wa_connections`.
 *
 * This class never interprets messages. It hands them to `onMessages`, one
 * batch at a time and in order, and retries that call if it fails (for
 * example while Postgres restarts), so a short outage loses nothing.
 */
export class WhatsAppConnection {
  private socket: SocketLike | undefined;
  private attempt = 0;
  private stopped = false;
  private status: ConnectionStatus = { state: 'stopped' };
  private downSince: number | undefined = Date.now();
  private chain: Promise<void> = Promise.resolve();
  private pairingRequested = false;
  private lastMessageSavedAt = 0;
  private readonly options: Required<
    Pick<ConnectionOptions, 'createSocket' | 'schedule' | 'random' | 'showQr'>
  > &
    ConnectionOptions;

  constructor(options: ConnectionOptions) {
    this.options = {
      createSocket: makeWASocket,
      schedule: (fn, ms) => setTimeout(fn, ms).unref(),
      random: Math.random,
      showQr: async (qr) => {
        const { toString } = await import('qrcode');
        const art = await toString(qr, { type: 'terminal', small: true });
        process.stdout.write(`\nScan this QR code with WhatsApp > Linked devices:\n${art}\n`);
      },
      ...options,
    };
  }

  get state(): ConnectionStatus['state'] {
    return this.status.state;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.socket?.end(undefined);
    this.socket = undefined;
    await this.chain;
    await this.setStatus({ state: 'stopped' });
  }

  /** Health check: fails when the connection has been down for too long. */
  healthCheck = (): Promise<void> => {
    if (this.status.state === 'awaiting_pairing') return Promise.resolve();
    if (this.downSince !== undefined && Date.now() - this.downSince > UNHEALTHY_AFTER_MS) {
      const minutes = Math.round((Date.now() - this.downSince) / 60_000);
      return Promise.reject(new Error(`WhatsApp ${this.status.state} for ${minutes} min`));
    }
    return Promise.resolve();
  };

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const { logger, db, account } = this.options;
    await this.setStatus({ state: 'starting' });
    const auth = await loadAuthStore(db, account);
    this.pairingRequested = false;

    const socket = this.options.createSocket({
      auth: {
        creds: auth.state.creds,
        keys: makeCacheableSignalKeyStore(auth.state.keys, logger),
      },
      // Baileys logs a lot at info level; only its warnings reach our logs.
      logger: logger.child({ component: 'baileys' }, { level: 'warn' }),
      browser: Browsers.ubuntu('Chrome'),
      // Not appearing "online" keeps notifications on the phone and looks
      // like a normal linked device.
      markOnlineOnConnect: false,
      // Only the small initial sync, not the full chat history. It must stay
      // on: Baileys learns the LID-to-phone mappings it needs from it. The
      // synced history messages themselves are not stored (we don't listen
      // to 'messaging-history.set').
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      shouldIgnoreJid: (jid) => jid === 'status@broadcast',
      // We never resend messages, so there is nothing to look up.
      getMessage: () => Promise.resolve(undefined),
    });
    this.socket = socket;

    socket.ev.process(async (events) => {
      if (socket !== this.socket) return; // events from an old, replaced socket
      if (events['creds.update']) await auth.saveCreds();
      if (events['connection.update']) {
        await this.onConnectionUpdate(socket, events['connection.update'], auth.clear);
      }
      if (events['messages.upsert']) this.onUpsert(events['messages.upsert']);
      if (events['groups.upsert']) {
        await this.reportGroups(events['groups.upsert'], false);
      }
      if (events['groups.update']) {
        const named = events['groups.update'].filter(
          (g): g is Partial<GroupMetadata> & { id: string; subject: string } =>
            typeof g.id === 'string' && typeof g.subject === 'string',
        );
        if (named.length > 0) await this.reportGroups(named, false);
      }
    });
  }

  private async onConnectionUpdate(
    socket: SocketLike,
    update: Partial<ConnectionState>,
    clearAuth: () => Promise<void>,
  ): Promise<void> {
    const { logger, pairingPhone } = this.options;

    if (update.qr) {
      if (pairingPhone) {
        if (!this.pairingRequested) {
          this.pairingRequested = true;
          const code = await socket.requestPairingCode(pairingPhone);
          logger.info(
            { pairingCode: code },
            'Enter this pairing code on the phone: WhatsApp > Linked devices > Link with phone number',
          );
          await this.setStatus({ state: 'awaiting_pairing', pairingCode: code, qr: null });
        }
      } else {
        logger.info('Waiting for QR pairing; QR code printed below');
        await this.options.showQr(update.qr);
        await this.setStatus({ state: 'awaiting_pairing', qr: update.qr, pairingCode: null });
      }
    }

    if (update.connection === 'open') {
      this.attempt = 0;
      this.downSince = undefined;
      logger.info('WhatsApp connected');
      await this.setStatus({
        state: 'open',
        qr: null,
        pairingCode: null,
        lastConnectedAt: new Date(),
      });
      await this.syncAllGroups(socket);
    }

    if (update.connection === 'close') {
      this.downSince ??= Date.now();
      const code = statusCodeOf(update);
      const reason = describeDisconnect(code);
      const disconnected = { lastDisconnectedAt: new Date(), lastDisconnectReason: reason };
      if (this.stopped) return;

      let delay: number;
      if (code === DisconnectReason.loggedOut) {
        // The number was unlinked (from the phone, or banned). The saved keys
        // are useless now; clear them so the next connect shows a new QR.
        logger.error({ reason }, 'WhatsApp logged this number out. Pair it again.');
        await clearAuth();
        await this.setStatus({ state: 'logged_out', ...disconnected });
        delay = 5_000;
      } else if (code === DisconnectReason.restartRequired) {
        // Normal right after pairing: WhatsApp asks for a fresh connection.
        logger.info('WhatsApp asked for a restart (normal after pairing)');
        await this.setStatus({ state: 'reconnecting', ...disconnected });
        delay = 0;
      } else {
        if (code === DisconnectReason.connectionReplaced) {
          logger.error(
            { reason },
            'Another session with this number connected. Is a second capture running?',
          );
        } else {
          logger.warn(
            { reason, error: update.lastDisconnect?.error?.message, attempt: this.attempt },
            'WhatsApp disconnected; reconnecting',
          );
        }
        await this.setStatus({ state: 'reconnecting', ...disconnected });
        delay =
          code === DisconnectReason.connectionReplaced
            ? MAX_RECONNECT_DELAY_MS
            : reconnectDelay(this.attempt, this.options.random);
        this.attempt += 1;
      }
      this.socket = undefined;
      this.scheduleReconnect(delay);
    }
  }

  /** Connects again after `delay` ms; if that attempt throws, backs off and tries again. */
  private scheduleReconnect(delay: number): void {
    this.options.schedule(() => {
      this.connect().catch((error: unknown) => {
        this.options.logger.error({ err: error }, 'Reconnect failed');
        this.socket = undefined;
        this.scheduleReconnect(reconnectDelay(this.attempt++, this.options.random));
      });
    }, delay);
  }

  /** Hands messages to onMessages one batch at a time, in arrival order. */
  private onUpsert(upsert: BaileysEventMap['messages.upsert']): void {
    const { messages } = upsert;
    if (messages.length === 0) return;
    this.chain = this.chain.then(() => this.deliver(messages));
  }

  private async deliver(messages: WAMessage[]): Promise<void> {
    const { logger } = this.options;
    // Retry for about two minutes (1 s, 2 s, 4 s ... 60 s), long enough to
    // ride out a Postgres restart. WhatsApp has already acknowledged these
    // messages, so giving up loses them; the error log names them.
    for (let attempt = 0; ; attempt++) {
      try {
        await this.options.onMessages(messages);
        break;
      } catch (error) {
        if (attempt >= 6) {
          logger.error(
            { err: error, waMessageIds: messages.map((m) => m.key.id) },
            'Could not store messages after retries; they are lost',
          );
          return;
        }
        logger.warn({ err: error, attempt }, 'Storing messages failed; retrying');
        await new Promise<void>((resolve) => {
          this.options.schedule(
            resolve,
            reconnectDelay(attempt, () => 1),
          );
        });
      }
    }
    // Throttled: the admin page only needs "last message" to the minute.
    if (Date.now() - this.lastMessageSavedAt > 10_000) {
      this.lastMessageSavedAt = Date.now();
      await this.setStatus({ lastMessageAt: new Date() }).catch(() => undefined);
    }
  }

  private async syncAllGroups(socket: SocketLike): Promise<void> {
    try {
      const groups = await socket.groupFetchAllParticipating();
      await this.reportGroups(Object.values(groups), true);
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Could not fetch the group list');
    }
  }

  private async reportGroups(
    groups: (Partial<GroupMetadata> & { id: string })[],
    complete: boolean,
  ): Promise<void> {
    const list = groups.map((g) => ({ jid: g.id, name: g.subject ?? null }));
    try {
      await this.options.onGroups(list, complete);
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Could not save groups');
    }
  }

  private async setStatus(patch: Partial<ConnectionStatus>): Promise<void> {
    this.status = { ...this.status, ...patch };
    try {
      await saveConnectionStatus(this.options.db, this.options.account, this.status);
    } catch (error) {
      this.options.logger.warn({ err: error }, 'Could not save connection status');
    }
  }
}
