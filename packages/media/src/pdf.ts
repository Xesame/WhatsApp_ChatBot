import { createCanvas } from '@napi-rs/canvas';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { Attempt } from '@reb/llm';
import type { Transcription } from './image.ts';

export interface PdfPage {
  page: number;
  /** `text`: read from the PDF itself (free, exact); `vision`: rendered and transcribed; `failed`: vision failed. */
  method: 'text' | 'vision' | 'failed';
  chars: number;
}

export interface PdfResult {
  text: string;
  pages: PdfPage[];
  /** Pages beyond the limit that were not read. */
  skippedPages: number;
  attempts: Attempt[];
}

export interface PdfOptions {
  /** Read at most this many pages (PDF_MAX_PAGES). */
  maxPages: number;
  /** A page with less text than this is treated as scanned and sent to vision. */
  minTextChars: number;
  /** Transcribes a rendered page image (PNG). */
  transcribe: (png: Buffer) => Promise<Transcription>;
}

/**
 * Reads a PDF (build plan, step 2). For each page, the text layer is used
 * when it has enough text: free and exact. Pages with little or no text
 * (scans, designed brochures saved as images) are rendered at 2× and sent to
 * the vision model.
 */
export async function readPdf(data: Buffer, options: PdfOptions): Promise<PdfResult> {
  const task = getDocument({ data: new Uint8Array(data), verbosity: 0 });
  try {
    const document = await task.promise;
    const count = Math.min(document.numPages, options.maxPages);
    const parts: string[] = [];
    const pages: PdfPage[] = [];
    const attempts: Attempt[] = [];

    for (let number = 1; number <= count; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const layer = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .trim();

      if (layer.replace(/\s/g, '').length >= options.minTextChars) {
        parts.push(`[Page ${number}]\n${layer}`);
        pages.push({ page: number, method: 'text', chars: layer.length });
        continue;
      }

      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await page.render({ canvas: canvas as never, viewport }).promise;
      const transcription = await options.transcribe(canvas.toBuffer('image/png'));
      attempts.push(...transcription.attempts);
      if (transcription.text === null) {
        pages.push({ page: number, method: 'failed', chars: 0 });
      } else {
        if (transcription.text) parts.push(`[Page ${number}]\n${transcription.text}`);
        pages.push({ page: number, method: 'vision', chars: transcription.text.length });
      }
    }
    return { text: parts.join('\n\n'), pages, skippedPages: document.numPages - count, attempts };
  } finally {
    await task.destroy();
  }
}
