import { downloadContentFromMessage } from 'baileys';
import type { Readable } from 'node:stream';
import type { MediaRef } from './parse.ts';

/**
 * Downloads and decrypts a media file from WhatsApp's servers.
 *
 * WhatsApp media is end-to-end encrypted: the file on the server is useless
 * without the `mediaKey` that came inside the message. Only the reference is
 * needed, not the original message, so a failed download can be retried
 * later from what is stored in `media_files.media_ref`.
 */
export async function downloadMedia(ref: MediaRef): Promise<Readable> {
  if (!ref.mediaKey || (!ref.url && !ref.directPath)) {
    throw new Error('Media reference is incomplete (no key or location)');
  }
  return downloadContentFromMessage(
    {
      mediaKey: Buffer.from(ref.mediaKey, 'base64'),
      directPath: ref.directPath,
      url: ref.url,
    },
    ref.kind,
  );
}
