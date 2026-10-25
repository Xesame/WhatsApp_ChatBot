import { mediaFiles, messages, waGroups, type Database, type Db } from '@reb/db';
import { enqueueInTransaction, type PgBoss, type TransactionClient } from '@reb/queue';
import type { MediaRef, ParsedMessage } from '@reb/whatsapp';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import type { Logger } from 'pino';
import { extensionFor, FileTooLargeError, storeStream } from './files.ts';
import { GroupDirectory } from './groups.ts';

export interface IngestorOptions {
  database: Database;
  boss: PgBoss;
  logger: Logger;
  mediaDir: string;
  maxMediaBytes: number;
  download: (ref: MediaRef) => Promise<Readable>;
  /** Download attempts before giving up on a file. Default 5. */
  maxMediaAttempts?: number;
  /** Downloads running at the same time. Default 3. */
  mediaConcurrency?: number;
  /** How often to retry pending downloads and queue stragglers. Default 5 min. */
  sweepIntervalMs?: number;
  /** Groups directory refresh interval. Default 30 s. */
  groupRefreshMs?: number;
}

export type SaveResult = 'saved' | 'duplicate' | 'unwatched' | 'ignored' | 'deleted';

/**
 * Stores parsed WhatsApp messages, downloads their media, and queues each
 * stored message for processing exactly once.
 *
 * Guarantees (each covered by tests):
 * - Saving the same message twice stores it once and queues it once.
 * - A message without media is saved and queued in one transaction.
 * - A message with media is queued after the file is saved (or after the
 *   download is given up on), so the worker always finds the file.
 * - If capture stops mid-download, the next start finishes the download and
 *   queues the message (`sweep`).
 */
export class Ingestor {
  readonly groups: GroupDirectory;
  private readonly inFlight = new Set<number>();
  private readonly waiting: (() => void)[] = [];
  private running = 0;
  private sweepTimer: NodeJS.Timeout | undefined;
  private readonly maxAttempts: number;
  private readonly concurrency: number;
  private readonly options: IngestorOptions;

  constructor(options: IngestorOptions) {
    this.options = options;
    this.groups = new GroupDirectory(options.database.db, options.groupRefreshMs);
    this.maxAttempts = options.maxMediaAttempts ?? 5;
    this.concurrency = options.mediaConcurrency ?? 3;
  }

  async start(): Promise<void> {
    await this.groups.start();
    await this.sweep();
    this.sweepTimer = setInterval(
      () =>
        void this.sweep().catch((err: unknown) => {
          this.options.logger.warn({ err }, 'Media sweep failed');
        }),
      this.options.sweepIntervalMs ?? 5 * 60_000,
    );
    this.sweepTimer.unref();
  }

  /** Stops timers and waits for downloads in progress. */
  async stop(): Promise<void> {
    clearInterval(this.sweepTimer);
    this.groups.stop();
    while (this.running > 0 || this.inFlight.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  /** Stores a batch in order. Media downloads continue in the background. */
  async handle(batch: ParsedMessage[]): Promise<SaveResult[]> {
    const results: SaveResult[] = [];
    for (const parsed of batch) results.push(await this.save(parsed));
    return results;
  }

  async save(parsed: ParsedMessage): Promise<SaveResult> {
    if (parsed.kind === 'ignore') return 'ignored';
    const groupId = await this.groups.watchedGroupId(parsed.groupJid);
    if (groupId === undefined) return 'unwatched';
    const { db } = this.options.database;

    if (parsed.kind === 'revoke') {
      // Keep the row: the listing may already be extracted. Phase 4 decides
      // what a deletion means for it.
      await db
        .update(messages)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(messages.groupId, groupId),
            eq(messages.waMessageId, parsed.targetWaMessageId),
            isNull(messages.deletedAt),
          ),
        );
      return 'deleted';
    }

    const media = parsed.kind === 'message' ? parsed.media : null;
    const tooLarge =
      media?.sizeBytes !== null &&
      media?.sizeBytes !== undefined &&
      media.sizeBytes > this.options.maxMediaBytes;

    const saved = await this.options.database.transaction(async (tx, client) => {
      const [row] = await tx
        .insert(messages)
        .values({
          groupId,
          waMessageId: parsed.waMessageId,
          senderHash: parsed.senderHash,
          sentAt: parsed.sentAt,
          text: parsed.text,
          quotedWaMessageId: parsed.kind === 'message' ? parsed.quotedWaMessageId : null,
          editOfWaMessageId: parsed.kind === 'edit' ? parsed.editOfWaMessageId : null,
          isForwarded: parsed.kind === 'message' ? parsed.isForwarded : false,
          mediaType: media?.kind ?? 'none',
        })
        .onConflictDoNothing()
        .returning({ id: messages.id });
      if (!row) return undefined; // already stored: nothing else to do

      await tx
        .update(waGroups)
        .set({
          lastMessageAt: sql`greatest(${waGroups.lastMessageAt}, ${parsed.sentAt.toISOString()}::timestamptz)`,
        })
        .where(eq(waGroups.id, groupId));

      let mediaId: number | undefined;
      if (media) {
        const [file] = await tx
          .insert(mediaFiles)
          .values({
            messageId: row.id,
            kind: media.kind,
            mimeType: media.mimeType,
            fileName: media.fileName,
            sizeBytes: media.sizeBytes,
            mediaRef: media.ref,
            status: tooLarge ? 'skipped' : 'pending',
            error: tooLarge ? `Larger than MEDIA_MAX_BYTES (${this.options.maxMediaBytes})` : null,
          })
          .returning({ id: mediaFiles.id });
        mediaId = file?.id;
      }
      if (!media || tooLarge) await this.enqueue(tx, client, row.id);
      return { messageId: row.id, mediaId: tooLarge ? undefined : mediaId };
    });

    if (!saved) return 'duplicate';
    if (saved.mediaId !== undefined) this.downloadInBackground(saved.mediaId);
    return 'saved';
  }

  /**
   * Queues a message's `preprocess` job unless it is already queued. The
   * conditional UPDATE makes this safe to call any number of times.
   */
  private async enqueue(tx: Db, client: TransactionClient, messageId: number): Promise<void> {
    const marked = await tx
      .update(messages)
      .set({ enqueuedAt: new Date() })
      .where(and(eq(messages.id, messageId), isNull(messages.enqueuedAt)))
      .returning({ id: messages.id });
    if (marked.length > 0) {
      await enqueueInTransaction(this.options.boss, client, 'preprocess', { messageId });
    }
  }

  private downloadInBackground(mediaId: number): void {
    void this.downloadMedia(mediaId).catch((err: unknown) => {
      this.options.logger.error({ err, mediaId }, 'Media download crashed');
    });
  }

  /** Downloads one file (if still pending), stores it, then queues its message. */
  async downloadMedia(mediaId: number): Promise<void> {
    if (this.inFlight.has(mediaId)) return;
    this.inFlight.add(mediaId);
    try {
      await this.acquireSlot();
      try {
        await this.tryDownload(mediaId);
      } finally {
        this.releaseSlot();
      }
    } finally {
      this.inFlight.delete(mediaId);
    }
  }

  private async tryDownload(mediaId: number): Promise<void> {
    const { database, logger } = this.options;
    const [file] = await database.db.select().from(mediaFiles).where(eq(mediaFiles.id, mediaId));
    if (!file || file.status !== 'pending') return;

    try {
      const stream = await this.options.download(file.mediaRef as MediaRef);
      const stored = await storeStream(stream, {
        mediaDir: this.options.mediaDir,
        maxBytes: this.options.maxMediaBytes,
        extension: extensionFor(file.mimeType, file.fileName),
      });
      await database.transaction(async (tx, client) => {
        await tx
          .update(mediaFiles)
          .set({
            status: 'downloaded',
            sha256: stored.sha256,
            sizeBytes: stored.sizeBytes,
            path: stored.path,
            attempts: file.attempts + 1,
            error: null,
            downloadedAt: new Date(),
          })
          .where(eq(mediaFiles.id, mediaId));
        await this.enqueue(tx, client, file.messageId);
      });
    } catch (error) {
      const attempts = file.attempts + 1;
      const tooLarge = error instanceof FileTooLargeError;
      const giveUp = tooLarge || attempts >= this.maxAttempts;
      const message = error instanceof Error ? error.message : String(error);
      logger.warn({ mediaId, attempts, giveUp, reason: message }, 'Media download failed');
      await database.transaction(async (tx, client) => {
        await tx
          .update(mediaFiles)
          .set({
            status: tooLarge ? 'skipped' : giveUp ? 'failed' : 'pending',
            attempts,
            error: message,
          })
          .where(eq(mediaFiles.id, mediaId));
        // Without the file, the message is still worth processing for its
        // caption, so it is queued anyway once we stop retrying.
        if (giveUp) await this.enqueue(tx, client, file.messageId);
      });
    }
  }

  /**
   * Catches up after a restart or an outage:
   * 1. retries downloads that are still pending;
   * 2. queues any stored message whose job was never queued (for example
   *    because capture stopped between saving a file and queuing).
   */
  async sweep(): Promise<void> {
    const { db } = this.options.database;
    const pending = await db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(and(eq(mediaFiles.status, 'pending'), lt(mediaFiles.attempts, this.maxAttempts)));
    for (const { id } of pending) this.downloadInBackground(id);

    const pendingMessageIds = pending.length
      ? (
          await db
            .select({ messageId: mediaFiles.messageId })
            .from(mediaFiles)
            .where(
              inArray(
                mediaFiles.id,
                pending.map((p) => p.id),
              ),
            )
        ).map((r) => r.messageId)
      : [];
    const stragglers = await db
      .select({ id: messages.id })
      .from(messages)
      .leftJoin(mediaFiles, eq(mediaFiles.messageId, messages.id))
      .where(
        and(
          isNull(messages.enqueuedAt),
          sql`(${mediaFiles.status} is null or ${mediaFiles.status} <> 'pending')`,
          pendingMessageIds.length ? sql`${messages.id} not in ${pendingMessageIds}` : undefined,
        ),
      );
    for (const { id } of stragglers) {
      await this.options.database.transaction((tx, client) => this.enqueue(tx, client, id));
    }
    if (pending.length || stragglers.length) {
      this.options.logger.info(
        { pendingDownloads: pending.length, queuedStragglers: stragglers.length },
        'Catch-up sweep',
      );
    }
  }

  private async acquireSlot(): Promise<void> {
    if (this.running < this.concurrency) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.running++;
  }

  private releaseSlot(): void {
    this.running--;
    this.waiting.shift()?.();
  }
}
