import { mediaFiles, messages, type Db } from '@reb/db';
import { scrubPersonalData } from '@reb/llm';
import { and, asc, between, eq, isNull, ne } from 'drizzle-orm';

export interface MessageContext {
  message: typeof messages.$inferSelect;
  /**
   * What the model reads as "the message", contact details removed: the
   * text, the text found in its image or PDF, and short follow-up texts the
   * same sender posted within the caption window.
   */
  text: string;
  /** The message it replies to (or, for an edit, the original), with its media text, scrubbed. */
  quoted: string | null;
  /** Everything the model saw, for the no-invention check. */
  sourceText: string;
}

const MEDIA_HEADER = '[Text in the attached file]';
const NEARBY_HEADER = '[Same sender, posted right before or after]';

async function mediaText(db: Db, messageId: number): Promise<string | null> {
  const [file] = await db
    .select({ text: mediaFiles.derivedText })
    .from(mediaFiles)
    .where(eq(mediaFiles.messageId, messageId));
  return file?.text?.trim() ? file.text : null;
}

/**
 * How a message's parts are laid out for the model: its text, the text found
 * in its file, and captions posted around it. Shared with `pnpm eval`, so the
 * eval reads media cases exactly as the pipeline does.
 */
export function composeMessageText(parts: {
  text: string | null;
  mediaText?: string | null;
  nearby?: string[];
}): string {
  const sections = [parts.text?.trim() ?? ''];
  if (parts.mediaText?.trim()) sections.push(`${MEDIA_HEADER}\n${parts.mediaText.trim()}`);
  if (parts.nearby?.length) sections.push(`${NEARBY_HEADER}\n${parts.nearby.join('\n')}`);
  return sections.filter(Boolean).join('\n\n');
}

/** The message's own text plus its media text. */
async function fullText(db: Db, message: { id: number; text: string | null }): Promise<string> {
  return composeMessageText({ text: message.text, mediaText: await mediaText(db, message.id) });
}

/**
 * Text messages from the same sender in the same group within `windowSeconds`
 * of a media message: the "flyer, then caption" pattern (build plan, step 3).
 */
export async function nearbyTexts(
  db: Db,
  message: Pick<typeof messages.$inferSelect, 'id' | 'groupId' | 'senderHash' | 'sentAt'>,
  windowSeconds: number,
) {
  const ms = windowSeconds * 1000;
  return db
    .select({
      id: messages.id,
      text: messages.text,
      mediaType: messages.mediaType,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.groupId, message.groupId),
        eq(messages.senderHash, message.senderHash),
        ne(messages.id, message.id),
        isNull(messages.deletedAt),
        between(
          messages.sentAt,
          new Date(message.sentAt.getTime() - ms),
          new Date(message.sentAt.getTime() + ms),
        ),
      ),
    )
    .orderBy(asc(messages.sentAt));
}

/**
 * Builds what the model reads for one message (build plan, step 3):
 * - the message text and the text found in its image or PDF;
 * - for an image or file: text-only messages the same sender posted within
 *   the caption window (a flyer, then its caption);
 * - the message it replies to (with that message's media text), so
 *   "السعر بقى 7 مليون" under a flyer can be understood.
 */
export async function assembleContext(
  db: Db,
  messageId: number,
  options: { captionWindowSeconds: number } = { captionWindowSeconds: 120 },
): Promise<MessageContext | null> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message) return null;

  const captions =
    message.mediaType === 'image' || message.mediaType === 'document'
      ? (await nearbyTexts(db, message, options.captionWindowSeconds))
          .filter((m) => m.mediaType === 'none' && m.text?.trim())
          .map((m) => m.text?.trim() ?? '')
      : [];
  const own = composeMessageText({
    text: message.text,
    mediaText: await mediaText(db, message.id),
    nearby: captions,
  });

  const contextId = message.quotedWaMessageId ?? message.editOfWaMessageId;
  let quoted: string | null = null;
  if (contextId) {
    const [earlier] = await db
      .select({ id: messages.id, text: messages.text })
      .from(messages)
      .where(and(eq(messages.groupId, message.groupId), eq(messages.waMessageId, contextId)));
    const earlierText = earlier ? await fullText(db, earlier) : '';
    quoted = earlierText ? scrubPersonalData(earlierText) : null;
  }
  const text = scrubPersonalData(own);
  return { message, text, quoted, sourceText: [text, quoted].filter(Boolean).join('\n') };
}
