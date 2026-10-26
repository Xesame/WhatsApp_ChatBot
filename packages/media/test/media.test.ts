import { createCanvas, loadImage } from '@napi-rs/canvas';
import { LlmClient, parseModelList } from '@reb/llm';
import ExcelJS from 'exceljs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  describeMedia,
  prepareImage,
  readPdf,
  readSpreadsheet,
  transcribeImage,
  type Transcription,
} from '../src/index.ts';

const PDF = new URL('./fixtures/price-list.pdf', import.meta.url);

/** A model API that answers every request with `answer` and records what was sent. */
function fakeVision(answer: string | null) {
  const bodies: Record<string, unknown>[] = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string) as Record<string, unknown>);
    if (answer === null) return Promise.resolve(new Response('{}', { status: 503 }));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: answer } }],
          usage: { prompt_tokens: 1200, completion_tokens: 300 },
        }),
      ),
    );
  }) as unknown as typeof fetch;
  const llm = new LlmClient({
    apiKeys: { gemini: 'k' },
    requestsPerMinute: 1000,
    timeoutMs: 1000,
    freeTier: true,
    fetch: fetchFn,
  });
  return { llm, bodies };
}
const models = parseModelList('gemini:gemini-flash-latest,gemini:gemini-flash-lite-latest');

const png = (width: number, height: number) => {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return canvas.toBuffer('image/png');
};

describe('readPdf', () => {
  it('uses the text layer where there is one, and vision for pages without text', async () => {
    const sent: number[] = [];
    const result = await readPdf(await readFile(PDF), {
      maxPages: 10,
      minTextChars: 20,
      transcribe: (image): Promise<Transcription> => {
        sent.push(image.length);
        return Promise.resolve({ text: 'شقق 2 غرف | 120 م | 7.2 مليون', attempts: [] });
      },
    });
    expect(result.pages.map((p) => p.method)).toEqual(['text', 'vision']);
    expect(sent).toHaveLength(1); // only the page without text went to vision
    expect(result.text).toContain('[Page 1]\nMivida - New Cairo\nApartment 3BR | 165 m | 9.8M');
    expect(result.text).toContain('[Page 2]\nشقق 2 غرف | 120 م | 7.2 مليون');
  });

  it('stops at the page limit and says how many pages were skipped', async () => {
    const result = await readPdf(await readFile(PDF), {
      maxPages: 1,
      minTextChars: 20,
      transcribe: () => Promise.resolve({ text: 'x', attempts: [] }),
    });
    expect(result.pages).toHaveLength(1);
    expect(result.skippedPages).toBe(1);
  });

  it('marks a page failed when vision fails, and keeps the other pages', async () => {
    const result = await readPdf(await readFile(PDF), {
      maxPages: 10,
      minTextChars: 20,
      transcribe: () => Promise.resolve({ text: null, attempts: [] }),
    });
    expect(result.pages.map((p) => p.method)).toEqual(['text', 'failed']);
    expect(result.text).toContain('Mivida');
  });
});

describe('readSpreadsheet', () => {
  it('turns each row into one line, cells separated by |', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Prices');
    sheet.addRow(['Unit', 'Area', 'Price']);
    sheet.addRow(['شقة 3 غرف', 165, 9_800_000]);
    sheet.addRow([]);
    sheet.addRow(['Townhouse', 210, { formula: '16500000', result: 16_500_000 }]);
    const text = await readSpreadsheet(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(text).toBe(
      '[Sheet Prices]\nUnit | Area | Price\nشقة 3 غرف | 165 | 9800000\nTownhouse | 210 | 16500000',
    );
  });
});

describe('prepareImage', () => {
  it('sends normal images unchanged', async () => {
    const image = png(800, 600);
    expect(await prepareImage(image, 'image/png')).toEqual({ data: image, mimeType: 'image/png' });
  });

  it('scales very large images down to 2000 px and re-encodes as JPEG', async () => {
    const prepared = await prepareImage(png(4000, 1000), 'image/png');
    expect(prepared.mimeType).toBe('image/jpeg');
    const decoded = await loadImage(prepared.data);
    expect([decoded.width, decoded.height]).toEqual([2000, 500]);
  });
});

describe('transcribeImage', () => {
  it('sends the image with the transcription prompt and records the call without the image data', async () => {
    const { llm, bodies } = fakeVision('ميفيدا\nشقة | 165 م | 9.8 مليون');
    const result = await transcribeImage(llm, models, {
      data: png(200, 100),
      mimeType: 'image/png',
    });
    expect(result.text).toBe('ميفيدا\nشقة | 165 م | 9.8 مليون');
    const content = (bodies[0]?.messages as { content: unknown }[])[1]?.content as {
      type: string;
      image_url?: { url: string };
    }[];
    expect(content[1]?.image_url?.url).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(bodies[0]).not.toHaveProperty('response_format');
    const recorded = JSON.stringify(result.attempts[0]?.request);
    expect(recorded).toMatch(/KB image omitted/);
    expect(recorded).not.toContain('iVBOR');
    expect(result.attempts[0]?.promptVersion).toMatch(/^transcribe-/);
    expect(result.attempts[0]?.inputTokens).toBe(1200);
  });

  it('treats "[no text]" as an empty transcription', async () => {
    const { llm } = fakeVision('[no text]');
    expect(
      (await transcribeImage(llm, models, { data: png(10, 10), mimeType: 'image/png' })).text,
    ).toBe('');
  });

  it('falls back to the second model, and returns null when both fail', async () => {
    const { llm, bodies } = fakeVision(null);
    const result = await transcribeImage(llm, models, { data: png(10, 10), mimeType: 'image/png' });
    expect(result.text).toBeNull();
    expect(bodies.map((b) => b.model)).toEqual(['gemini-flash-latest', 'gemini-flash-lite-latest']);
  });
});

describe('describeMedia', () => {
  const options = (answer: string | null = 'text') => ({
    llm: fakeVision(answer).llm,
    visionModels: models,
    pdfMaxPages: 10,
    pdfMinTextChars: 20,
  });

  it.each<[string, Parameters<typeof describeMedia>[0], string]>([
    [
      'voice notes',
      { kind: 'audio', mimeType: 'audio/ogg', fileName: null, data: Buffer.alloc(1) },
      'Voice notes are not processed',
    ],
    [
      'videos',
      { kind: 'video', mimeType: 'video/mp4', fileName: null, data: Buffer.alloc(1) },
      'Videos are not processed',
    ],
    [
      'Word documents',
      {
        kind: 'document',
        mimeType: 'application/msword',
        fileName: 'a.doc',
        data: Buffer.alloc(1),
      },
      'Document type not supported (application/msword)',
    ],
  ])('skips %s', async (_label, media, reason) => {
    expect(await describeMedia(media, options())).toEqual({ status: 'skipped', reason });
  });

  it('reads a PDF by its text layer and vision', async () => {
    const result = await describeMedia(
      {
        kind: 'document',
        mimeType: 'application/pdf',
        fileName: 'prices.pdf',
        data: await readFile(PDF),
      },
      options('صفحة ممسوحة'),
    );
    expect(result).toMatchObject({ status: 'ok', method: 'pdf' });
    expect(result.status === 'ok' && result.text).toContain('صفحة ممسوحة');
  });

  it('reports a failed image when every vision model fails', async () => {
    const result = await describeMedia(
      { kind: 'image', mimeType: 'image/png', fileName: null, data: png(10, 10) },
      options(null),
    );
    expect(result.status).toBe('failed');
  });
});
