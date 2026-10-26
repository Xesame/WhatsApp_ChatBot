import { createCanvas } from '@napi-rs/canvas';
import { extractionRuns, mediaFiles, messages, units, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { DEFAULT_TOLERANCES } from '@reb/dedup';
import { parseModelList, type LlmClient } from '@reb/llm';
import { startQueue, type PgBoss } from '@reb/queue';
import type { RawUnit } from '@reb/schema';
import { asc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  classify,
  extract,
  preprocess,
  RetryableError,
  transcribe,
  type PipelineDeps,
} from '../src/index.ts';
import { fakeModel } from './fake-model.ts';

const PRICE_SHEET = `ميفيدا - إعمار
النوع | المساحة | السعر
شقة 2 غرف | 120 م | 7.2 مليون
شقة 3 غرف | 165 م | 9.8 مليون
تاون هاوس | 210 م | 16.5 مليون
توين هاوس | 260 م | 21 مليون`;

const blank: RawUnit = {
  category: null,
  developer: null,
  project: null,
  city: null,
  unit_type: null,
  unit_code: null,
  floor: null,
  finishing: null,
  bedrooms: null,
  bathrooms: null,
  area: null,
  land_area: null,
  garden_area: null,
  outdoor_area: null,
  price: null,
  delivery: null,
  maintenance: null,
  down_payment: null,
  installments: null,
  cash_discount: null,
  notes: null,
  evidence: { project: null, unit_type: null, area: null, price: null },
};
const row = (unit_type: string, bedrooms: string | null, area: string, price: string) => ({
  ...blank,
  developer: 'إعمار',
  project: 'ميفيدا',
  unit_type,
  bedrooms,
  area,
  price,
  delivery: 'استلام 2029',
});
const sheetExtraction = {
  units: [
    row('Apartment', '2 غرف', '120 م', '7.2 مليون'),
    row('Apartment', '3 غرف', '165 م', '9.8 مليون'),
    row('Townhouse', null, '210 م', '16.5 مليون'),
    row('Twin House', null, '260 م', '21 مليون'),
  ],
};

describe.skipIf(!testDatabaseUrl)(
  'media pipeline (real Postgres, files on disk, fake vision model)',
  () => {
    let testDb: TestDatabase;
    let boss: PgBoss;
    let mediaDir: string;
    let groupId: number;
    const logger = pino({ level: 'silent' });

    const deps = (llm: LlmClient): PipelineDeps => ({
      database: testDb.database,
      boss,
      llm,
      models: { classify: parseModelList('gemini:text'), extract: parseModelList('gemini:text') },
      logger,
      tolerances: DEFAULT_TOLERANCES,
      media: {
        mediaDir,
        visionModels: parseModelList('gemini:vision-a,gemini:vision-b'),
        pdfMaxPages: 10,
        pdfMinTextChars: 20,
        captionWindowSeconds: 120,
      },
    });

    let counter = 0;
    /** A message from `sender` with an attached file saved under MEDIA_DIR. */
    const post = async (options: {
      text?: string | null;
      sentAt?: Date;
      sender?: string;
      file?: {
        kind: 'image' | 'document' | 'audio' | 'video';
        name: string;
        mimeType: string;
        data: Buffer;
        status?: 'downloaded' | 'failed';
      };
    }) => {
      counter += 1;
      const [message] = await testDb.database.db
        .insert(messages)
        .values({
          groupId,
          waMessageId: `W${counter}`,
          senderHash: (options.sender ?? 'a').repeat(64),
          sentAt: options.sentAt ?? new Date('2026-10-26T09:00:00Z'),
          text: options.text ?? null,
          mediaType: options.file?.kind ?? 'none',
        })
        .returning();
      if (!message) throw new Error('insert failed');
      if (options.file) {
        const status = options.file.status ?? 'downloaded';
        if (status === 'downloaded')
          await writeFile(join(mediaDir, options.file.name), options.file.data);
        await testDb.database.db.insert(mediaFiles).values({
          messageId: message.id,
          kind: options.file.kind,
          mimeType: options.file.mimeType,
          fileName: options.file.name,
          status,
          path: status === 'downloaded' ? options.file.name : null,
          error: status === 'failed' ? 'media expired' : null,
          mediaRef: {},
        });
      }
      return message;
    };
    const png = () => {
      const canvas = createCanvas(400, 300);
      canvas.getContext('2d').fillRect(0, 0, 10, 10);
      return {
        kind: 'image' as const,
        name: `flyer-${counter}.png`,
        mimeType: 'image/jpeg',
        data: canvas.toBuffer('image/png'),
      };
    };
    const fileOf = async (messageId: number) =>
      (
        await testDb.database.db
          .select()
          .from(mediaFiles)
          .where(eq(mediaFiles.messageId, messageId))
      )[0];
    const statusOf = async (messageId: number) =>
      (await testDb.database.db.select().from(messages).where(eq(messages.id, messageId)))[0];
    const classifyJobs = async () =>
      (
        await testDb.database.pool.query<{ data: { messageId: number }; start_after: Date }>(
          `select data, start_after from pgboss.job where name = 'classify' order by created_on`,
        )
      ).rows;

    beforeAll(async () => {
      testDb = await createTestDatabase(testDatabaseUrl ?? '');
      await seed(testDb.database.db);
      boss = await startQueue(testDb.url, { supervise: false, onError: () => undefined });
      mediaDir = await mkdtemp(join(tmpdir(), 'reb-media-pipeline-'));
      const [group] = await testDb.database.db
        .insert(waGroups)
        .values({ jid: 'm@g.us', watched: true })
        .returning({ id: waGroups.id });
      groupId = group?.id ?? 0;
    });
    afterAll(async () => {
      await boss.stop({ graceful: false });
      await testDb.drop();
    });
    beforeEach(async () => {
      await testDb.database.pool.query(
        'truncate unit_prices, unit_sources, units, extraction_runs, media_files, messages restart identity cascade; delete from pgboss.job',
      );
    });

    it('acceptance: a price-sheet image with many units gives one row per unit type, with its caption', async () => {
      const sentAt = new Date(Date.now() - 10_000);
      const flyer = await post({ file: png(), sentAt });
      const caption = await post({
        text: 'الأسعار الجديدة - استلام 2029',
        sentAt: new Date(sentAt.getTime() + 30_000),
      });

      expect(await preprocess(deps(fakeModel({}).llm), flyer.id)).toBe('queued');
      expect(await preprocess(deps(fakeModel({}).llm), caption.id)).toBe('skipped');
      expect((await statusOf(caption.id))?.error).toBe(
        `Caption of message ${flyer.id} (image); read together with it`,
      );

      const model = fakeModel({
        transcription: PRICE_SHEET,
        classification: { intent: 'listing' },
        extraction: sheetExtraction,
      });
      expect(await transcribe(deps(model.llm), flyer.id, { lastAttempt: false })).toBe('vision');
      expect(await fileOf(flyer.id)).toMatchObject({
        derivedText: PRICE_SHEET,
        derivedMethod: 'vision',
      });

      // classification waits until the caption window (2 min after the flyer) has passed
      const [job] = await classifyJobs();
      expect(job?.data).toEqual({ messageId: flyer.id });
      expect(job?.start_after.getTime()).toBeGreaterThanOrEqual(sentAt.getTime() + 119_000);

      // per-message cost and latency for the media are recorded
      const [run] = await testDb.database.db.select().from(extractionRuns);
      expect(run).toMatchObject({
        purpose: 'transcribe',
        mediaFileId: (await fileOf(flyer.id))?.id,
        model: 'vision-a',
        inputTokens: 500,
        outputTokens: 200,
        costUsd: 0,
        status: 'ok',
      });
      expect(run?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(run?.promptVersion).toMatch(/^transcribe-/);
      expect(JSON.stringify(run?.request)).toMatch(/KB image omitted/);

      await classify(deps(model.llm), flyer.id);
      const result = await extract(deps(model.llm), flyer.id, 'listing');
      const extractBody = model.bodies.at(-1) ?? '';
      expect(extractBody).toContain('[Text in the attached file]');
      expect(extractBody).toContain('توين هاوس | 260 م | 21 مليون');
      expect(extractBody).toContain('الأسعار الجديدة - استلام 2029'); // the caption
      expect(result?.created).toHaveLength(4);
      const rows = await testDb.database.db.select().from(units).orderBy(asc(units.id));
      expect(
        rows.map((u) => [u.unitType, u.bedrooms, u.minArea, u.minPrice, u.deliveryYear]),
      ).toEqual([
        ['Apartment', 2, 120, 720_000_000, 2029],
        ['Apartment', 3, 165, 980_000_000, 2029],
        ['Townhouse', null, 210, 1_650_000_000, 2029],
        ['Twin House', null, 260, 2_100_000_000, 2029],
      ]);
      for (const u of rows)
        expect(u.reviewReasons.filter((r) => r.startsWith('Dropped'))).toEqual([]);
    });

    it('reads a text PDF without any model call', async () => {
      const pdf = await post({
        file: {
          kind: 'document',
          name: 'prices.pdf',
          mimeType: 'application/pdf',
          data: Buffer.alloc(0),
        },
      });
      await copyFile(
        new URL('../../media/test/fixtures/price-list.pdf', import.meta.url),
        join(mediaDir, 'prices.pdf'),
      );
      const model = fakeModel({ transcription: 'صفحة ممسوحة' });
      expect(await transcribe(deps(model.llm), pdf.id, { lastAttempt: false })).toBe('pdf');
      const file = await fileOf(pdf.id);
      expect(file?.derivedText).toContain('Apartment 3BR | 165 m | 9.8M');
      // the fixture's second page has no text layer, so it alone went to vision
      expect(model.bodies).toHaveLength(1);
      expect(file?.derivedText).toContain('صفحة ممسوحة');
    });

    it('reads an Excel price list directly', async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet('Prices').addRows([
        ['Unit', 'Price'],
        ['Villa', 30_000_000],
      ]);
      const sheet = await post({
        file: {
          kind: 'document',
          name: 'prices.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          data: Buffer.from(await workbook.xlsx.writeBuffer()),
        },
      });
      const model = fakeModel({});
      expect(await transcribe(deps(model.llm), sheet.id, { lastAttempt: false })).toBe(
        'spreadsheet',
      );
      expect((await fileOf(sheet.id))?.derivedText).toBe(
        '[Sheet Prices]\nUnit | Price\nVilla | 30000000',
      );
      expect(model.bodies).toEqual([]);
    });

    it('retries when vision fails, and on the last attempt goes on with the caption', async () => {
      const flyer = await post({ file: png(), text: 'شقة 3 غرف ميفيدا 9.8 مليون' });
      const model = fakeModel({ failVision: true });
      await expect(transcribe(deps(model.llm), flyer.id, { lastAttempt: false })).rejects.toThrow(
        RetryableError,
      );
      expect(await statusOf(flyer.id)).toMatchObject({ status: 'failed' });
      expect(await classifyJobs()).toEqual([]);

      expect(await transcribe(deps(model.llm), flyer.id, { lastAttempt: true })).toBe('failed');
      expect(await fileOf(flyer.id)).toMatchObject({ derivedMethod: 'failed', derivedText: null });
      expect((await classifyJobs()).map((j) => j.data)).toEqual([{ messageId: flyer.id }]);
      // two models tried on each of the two attempts
      expect(await testDb.database.db.select().from(extractionRuns)).toHaveLength(4);
    });

    it('goes on with the caption when the file never downloaded', async () => {
      const flyer = await post({ file: { ...png(), status: 'failed' }, text: 'شقة للبيع' });
      expect(await transcribe(deps(fakeModel({}).llm), flyer.id, { lastAttempt: false })).toBe(
        'failed',
      );
      expect(await fileOf(flyer.id)).toMatchObject({
        derivedError: 'File not downloaded (failed: media expired)',
      });
      expect(await classifyJobs()).toHaveLength(1);
    });

    it('skips an image with no text, no caption, once the window has passed', async () => {
      const flyer = await post({ file: png(), sentAt: new Date('2026-10-01T09:00:00Z') });
      await transcribe(deps(fakeModel({ transcription: '[no text]' }).llm), flyer.id, {
        lastAttempt: false,
      });
      expect(await statusOf(flyer.id)).toMatchObject({
        status: 'skipped',
        error: 'No text in the message or its file',
      });
      expect(await classifyJobs()).toEqual([]);
    });

    it('a video with a caption is read by its caption only', async () => {
      const video = await post({
        file: { kind: 'video', name: 'tour.mp4', mimeType: 'video/mp4', data: Buffer.alloc(1) },
        text: 'فيلا للبيع',
      });
      expect(await preprocess(deps(fakeModel({}).llm), video.id)).toBe('queued');
      expect((await classifyJobs()).map((j) => j.data)).toEqual([{ messageId: video.id }]);
    });

    it("a reply under a flyer sees the flyer's text", async () => {
      const flyer = await post({ file: png() });
      const model = fakeModel({ transcription: PRICE_SHEET });
      await transcribe(deps(model.llm), flyer.id, { lastAttempt: false });
      const reply = await post({ text: 'الشقة 3 غرف بقت 9.5 مليون', sender: 'b' });
      await testDb.database.db
        .update(messages)
        .set({ quotedWaMessageId: flyer.waMessageId })
        .where(eq(messages.id, reply.id));
      const extracting = fakeModel({ extraction: { units: [] } });
      await extract(deps(extracting.llm), reply.id, 'price_update');
      expect(extracting.bodies[0]).toContain('شقة 3 غرف | 165 م | 9.8 مليون');
    });
  },
);
