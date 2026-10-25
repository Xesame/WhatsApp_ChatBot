import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/**
 * File extension for a stored media file: from the MIME type (WhatsApp sends
 * e.g. "audio/ogg; codecs=opus"), else from the original file name, else "bin".
 */
export function extensionFor(mimeType: string | null, fileName: string | null): string {
  const base = mimeType?.split(';')[0]?.trim().toLowerCase();
  if (base && EXTENSIONS[base]) return EXTENSIONS[base];
  const fromName = fileName ? extname(fileName).slice(1).toLowerCase() : '';
  return /^[a-z0-9]{1,8}$/.test(fromName) ? fromName : 'bin';
}

/** Where a file with this hash lives, relative to MEDIA_DIR: `ab/cd/abcd...ef.jpg`. */
export function mediaPath(sha256: string, extension: string): string {
  return join(sha256.slice(0, 2), sha256.slice(2, 4), `${sha256}.${extension}`);
}

export class FileTooLargeError extends Error {
  override name = 'FileTooLargeError';
}

export interface StoredFile {
  sha256: string;
  sizeBytes: number;
  /** Relative to MEDIA_DIR. */
  path: string;
}

/**
 * Streams a download to disk while hashing it, then moves it to its
 * content-addressed path. The file is never held in memory, and identical
 * files (the same flyer posted in several groups) are stored once.
 *
 * Throws FileTooLargeError (and keeps nothing) if the stream passes `maxBytes`.
 */
export async function storeStream(
  source: Readable,
  options: { mediaDir: string; maxBytes: number; extension: string },
): Promise<StoredFile> {
  const tmpDir = join(options.mediaDir, '.tmp');
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = join(tmpDir, randomUUID());
  const hash = createHash('sha256');
  let size = 0;

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > options.maxBytes) {
        done(new FileTooLargeError(`File is larger than ${options.maxBytes} bytes`));
        return;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });

  try {
    await pipeline(source, meter, createWriteStream(tmpPath));
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }

  const sha256 = hash.digest('hex');
  const path = mediaPath(sha256, options.extension);
  const finalPath = join(options.mediaDir, path);
  await mkdir(dirname(finalPath), { recursive: true });
  const exists = await stat(finalPath).then(
    () => true,
    () => false,
  );
  if (exists) await rm(tmpPath, { force: true });
  else await rename(tmpPath, finalPath);
  return { sha256, sizeBytes: size, path };
}
