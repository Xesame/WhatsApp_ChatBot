import type { Attempt, LlmClient, ModelRef } from '@reb/llm';
import { transcribeImage } from './image.ts';
import { readPdf, type PdfPage } from './pdf.ts';
import { readSpreadsheet } from './sheet.ts';

export interface MediaInput {
  kind: 'image' | 'video' | 'audio' | 'document';
  mimeType: string | null;
  fileName: string | null;
  data: Buffer;
}

export type MediaText =
  | {
      status: 'ok';
      text: string;
      method: 'vision' | 'pdf' | 'spreadsheet';
      attempts: Attempt[];
      pages?: PdfPage[];
    }
  | { status: 'failed'; reason: string; attempts: Attempt[] }
  | { status: 'skipped'; reason: string };

export interface MediaOptions {
  llm: LlmClient;
  visionModels: ModelRef[];
  pdfMaxPages: number;
  pdfMinTextChars: number;
}

const isPdf = (m: MediaInput) =>
  m.mimeType?.includes('pdf') === true || /\.pdf$/i.test(m.fileName ?? '');
const isSpreadsheet = (m: MediaInput) =>
  /spreadsheetml|ms-excel/.test(m.mimeType ?? '') || /\.xlsx$/i.test(m.fileName ?? '');

/**
 * Text for one media file (build plan, step 2):
 * images → vision; PDFs → text layer, vision for scanned pages;
 * Excel price lists → read directly. Voice notes and videos are not
 * processed (decided with Hassan); other documents are not supported yet.
 */
export async function describeMedia(media: MediaInput, options: MediaOptions): Promise<MediaText> {
  if (media.kind === 'audio') return { status: 'skipped', reason: 'Voice notes are not processed' };
  if (media.kind === 'video') return { status: 'skipped', reason: 'Videos are not processed' };

  if (media.kind === 'image') {
    const result = await transcribeImage(options.llm, options.visionModels, media);
    return result.text === null
      ? {
          status: 'failed',
          reason: result.attempts.at(-1)?.error ?? 'no vision model available',
          attempts: result.attempts,
        }
      : { status: 'ok', text: result.text, method: 'vision', attempts: result.attempts };
  }

  if (isPdf(media)) {
    const result = await readPdf(media.data, {
      maxPages: options.pdfMaxPages,
      minTextChars: options.pdfMinTextChars,
      transcribe: (png) =>
        transcribeImage(options.llm, options.visionModels, { data: png, mimeType: 'image/png' }),
    });
    if (result.pages.length > 0 && result.pages.every((p) => p.method === 'failed')) {
      return { status: 'failed', reason: 'Vision failed on every page', attempts: result.attempts };
    }
    const note =
      result.skippedPages > 0 ? `\n\n[${result.skippedPages} more page(s) not read]` : '';
    return {
      status: 'ok',
      text: result.text + note,
      method: 'pdf',
      attempts: result.attempts,
      pages: result.pages,
    };
  }

  if (isSpreadsheet(media)) {
    return {
      status: 'ok',
      text: await readSpreadsheet(media.data),
      method: 'spreadsheet',
      attempts: [],
    };
  }
  return {
    status: 'skipped',
    reason: `Document type not supported (${media.mimeType ?? media.fileName ?? 'unknown'})`,
  };
}
