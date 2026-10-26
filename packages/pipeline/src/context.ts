import { messages, type Db } from '@reb/db';
import { scrubPersonalData } from '@reb/llm';
import { and, eq } from 'drizzle-orm';

export interface MessageContext {
  message: typeof messages.$inferSelect;
  /** The message text with contact details removed: what the model sees. */
  text: string;
  /** The message it replies to (or, for an edit, the original), scrubbed. */
  quoted: string | null;
  /** Everything the model saw, for the no-invention check. */
  sourceText: string;
}

/**
 * Builds what the model reads for one message (build plan, step 3): the
 * message text plus the message it replies to, so "السعر بقى 7 مليون" as a
 * reply to a listing can be understood. Media text joins this in Phase 3.
 */
export async function assembleContext(db: Db, messageId: number): Promise<MessageContext | null> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!message) return null;

  const contextId = message.quotedWaMessageId ?? message.editOfWaMessageId;
  let quoted: string | null = null;
  if (contextId) {
    const [earlier] = await db
      .select({ text: messages.text })
      .from(messages)
      .where(and(eq(messages.groupId, message.groupId), eq(messages.waMessageId, contextId)));
    quoted = earlier?.text ? scrubPersonalData(earlier.text) : null;
  }
  const text = scrubPersonalData(message.text ?? '');
  return { message, text, quoted, sourceText: [text, quoted].filter(Boolean).join('\n') };
}
