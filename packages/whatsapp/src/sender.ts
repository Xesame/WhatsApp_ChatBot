import { createHmac } from 'node:crypto';
import { isLidUser, jidNormalizedUser, type WAMessageKey } from 'baileys';

/**
 * Picks one stable identifier for the sender of a group message.
 *
 * WhatsApp now identifies group members by a "LID" (a private ID) and, when
 * known, also by their phone-number JID. The same person can arrive with
 * either one as the main ID, so we prefer the LID whenever it is available.
 * That way one sender always gets one hash.
 */
export function senderIdentity(key: WAMessageKey): string | undefined {
  const candidates = [key.participant, key.participantAlt]
    .filter((jid): jid is string => typeof jid === 'string' && jid.length > 0)
    .map((jid) => jidNormalizedUser(jid));
  return candidates.find((jid) => isLidUser(jid)) ?? candidates[0];
}

/**
 * One-way, salted hash of a sender identity (HMAC-SHA256, hex).
 *
 * Phone numbers are a small, guessable space: a plain SHA-256 of a phone
 * number can be reversed by hashing every possible number. The secret salt
 * prevents that. The raw identity never leaves this package.
 */
export function hashSender(salt: string, identity: string): string {
  return createHmac('sha256', salt).update(identity).digest('hex');
}
