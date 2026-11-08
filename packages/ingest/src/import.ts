import {
  mediaFiles,
  messages,
  waGroups,
  type Database,
  type GROUP_SOURCE_TYPES,
  type MEDIA_KINDS,
} from '@reb/db';
import { enqueueInTransaction, type PgBoss } from '@reb/queue';
import { hashSender } from '@reb/whatsapp';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { SampleMessage } from './chat-export.ts';
import { storeStream } from './files.ts';

type Kind = (typeof MEDIA_KINDS)[number];
const TYPES: Record<string, { kind: Kind; mime: string }> = {
  jpg: { kind: 'image', mime: 'image/jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg' },
  png: { kind: 'image', mime: 'image/png' },
  webp: { kind: 'image', mime: 'image/webp' },
  pdf: { kind: 'document', mime: 'application/pdf' },
  xlsx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  xls: { kind: 'document', mime: 'application/vnd.ms-excel' },
  docx: {
    kind: 'document',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  mp4: { kind: 'video', mime: 'video/mp4' },
  opus: { kind: 'audio', mime: 'audio/ogg' },
  ogg: { kind: 'audio', mime: 'audio/ogg' },
};

export interface ImportOptions {
  /** Name shown on the Groups page; messages go into a watched group of this name. */
  groupName: string;
  sourceType: (typeof GROUP_SOURCE_TYPES)[number] | null;
  /** SENDER_HASH_SALT: senders are stored only as a salted hash, as in capture. */
  salt: string;
  mediaDir: string;
  maxMediaBytes: number;
  /** Folder holding the attached files (usually the export's own folder). */
  filesDir: string;
  /** Move all times forward so the newest message is now, keeping their order and gaps. */
  shiftToNow: boolean;
  now?: Date;
}

export interface ImportResult {
  groupId: number;
  saved: number;
  alreadyImported: number;
  withFiles: number;
  missingFiles: string[];
  mediaOmitted: number;
}

/**
 * Stores sample messages the way capture stores WhatsApp messages, and queues
 * each one for the pipeline exactly once. Running the same file twice adds
 * nothing: each message gets an id from its content.
 */
export async function importSamples(
  database: Database,
  boss: PgBoss,
  samples: SampleMessage[],
  options: ImportOptions,
): Promise<ImportResult> {
  const { db } = database;
  const slug =
    options.groupName
      .toLowerCase()
      .replace(/[^a-z0-9؀-ۿ]+/g, '-')
      .replace(/^-|-$/g, '') || 'samples';
  const jid = `import-${slug}@g.us`;
  const [group] = await db
    .insert(waGroups)
    .values({ jid, name: options.groupName, watched: true, sourceType: options.sourceType })
    .onConflictDoUpdate({
      target: waGroups.jid,
      set: { name: options.groupName, watched: true, sourceType: options.sourceType },
    })
    .returning({ id: waGroups.id });
  if (!group) throw new Error('Could not create the import group');

  const newest = Math.max(...samples.map((s) => s.sentAt.getTime()));
  const shift =
    options.shiftToNow && samples.length > 0 ? (options.now ?? new Date()).getTime() - newest : 0;
  const result: ImportResult = {
    groupId: group.id,
    saved: 0,
    alreadyImported: 0,
    withFiles: 0,
    missingFiles: [],
    mediaOmitted: 0,
  };

  for (const sample of samples) {
    const waMessageId = `import-${createHash('sha256')
      .update(
        [
          jid,
          sample.sentAt.toISOString(),
          sample.sender,
          sample.text,
          sample.attachment ?? '',
        ].join('\n'),
      )
      .digest('hex')
      .slice(0, 32)}`;
    const sentAt = new Date(sample.sentAt.getTime() + shift);
    if (sample.mediaOmitted) result.mediaOmitted++;

    // store the attached file first, so the message is queued with it
    let file: {
      kind: Kind;
      mime: string;
      name: string;
      sha256: string;
      sizeBytes: number;
      path: string;
    } | null = null;
    if (sample.attachment) {
      const name = basename(sample.attachment);
      const full = join(options.filesDir, name);
      const type = TYPES[extname(name).slice(1).toLowerCase()];
      if (type && (await stat(full).catch(() => null))?.isFile()) {
        const stored = await storeStream(createReadStream(full), {
          mediaDir: options.mediaDir,
          maxBytes: options.maxMediaBytes,
          extension: extname(name).slice(1).toLowerCase(),
        });
        file = { kind: type.kind, mime: type.mime, name, ...stored };
      } else {
        result.missingFiles.push(name);
      }
    }

    const saved = await database.transaction(async (tx, client) => {
      const [row] = await tx
        .insert(messages)
        .values({
          groupId: group.id,
          waMessageId,
          senderHash: hashSender(options.salt, `import:${sample.sender}`),
          sentAt,
          text: sample.text || null,
          mediaType: file?.kind ?? 'none',
          enqueuedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning({ id: messages.id });
      if (!row) return false;
      if (file) {
        await tx.insert(mediaFiles).values({
          messageId: row.id,
          kind: file.kind,
          mimeType: file.mime,
          fileName: file.name,
          sizeBytes: file.sizeBytes,
          sha256: file.sha256,
          path: file.path,
          status: 'downloaded',
          attempts: 1,
          downloadedAt: new Date(),
          mediaRef: { imported: true },
        });
      }
      await tx
        .update(waGroups)
        .set({
          lastMessageAt: sql`greatest(${waGroups.lastMessageAt}, ${sentAt.toISOString()}::timestamptz)`,
        })
        .where(eq(waGroups.id, group.id));
      await enqueueInTransaction(boss, client, 'preprocess', { messageId: row.id });
      return true;
    });
    if (saved) {
      result.saved++;
      if (file) result.withFiles++;
    } else {
      result.alreadyImported++;
    }
  }
  return result;
}
