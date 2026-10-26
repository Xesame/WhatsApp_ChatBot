import { extractionRuns, mediaFiles, messages, units, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { LlmClient, parseModelList } from '@reb/llm';
import { startQueue, type PgBoss } from '@reb/queue';
import { TEMPLATE_HEADERS, unitSchema, type RawUnit } from '@reb/schema';
import { readHeaderRow } from '@reb/schema/export';
import { asc, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  classify,
  exportUnits,
  extract,
  matchEntities,
  mightBeListing,
  preprocess,
  RetryableError,
  type PipelineDeps,
} from '../src/index.ts';

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

const MULTI_UNIT = `لانش جديد في ميفيدا - اعمار
شقق 2 غرف 120 متر تبدأ من 7.2 مليون
شقق 3 غرف 165 متر 9.8 مليون
تاون هاوس 210 متر 16.5 مليون
مقدم 10% وتقسيط 8 سنين ربع سنوي، استلام 2029
للتواصل 01001234567`;

/** A stand-in for the model API: answers by schema name with canned replies. */
function fakeModel(replies: { classification?: unknown; extraction?: unknown; fail?: boolean }) {
  const bodies: string[] = [];
  const fetchFn = ((_url: string, init: RequestInit) => {
    const body = init.body as string;
    bodies.push(body);
    if (replies.fail) return Promise.resolve(new Response('{}', { status: 503 }));
    const name = (JSON.parse(body) as { response_format: { json_schema: { name: string } } })
      .response_format.json_schema.name;
    const content = JSON.stringify(
      name === 'classification' ? replies.classification : replies.extraction,
    );
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 500, completion_tokens: 200 },
        }),
      ),
    );
  }) as unknown as typeof fetch;
  return {
    bodies,
    llm: new LlmClient({
      apiKeys: { cerebras: 'test' },
      requestsPerMinute: 1000,
      timeoutMs: 1000,
      freeTier: true,
      fetch: fetchFn,
    }),
  };
}

describe.skipIf(!testDatabaseUrl)('pipeline (real Postgres and pg-boss, fake model)', () => {
  let testDb: TestDatabase;
  let boss: PgBoss;
  let groupId: number;
  const logger = pino({ level: 'silent' });
  const models = {
    classify: parseModelList('cerebras:a,cerebras:b'),
    extract: parseModelList('cerebras:a'),
  };
  const deps = (llm: LlmClient): PipelineDeps => ({
    database: testDb.database,
    boss,
    llm,
    models,
    logger,
  });

  const addMessage = async (values: Partial<typeof messages.$inferInsert>) => {
    const [row] = await testDb.database.db
      .insert(messages)
      .values({
        groupId,
        waMessageId: `W${Math.random()}`,
        senderHash: 'h'.repeat(64),
        sentAt: new Date('2026-10-26T09:00:00Z'),
        text: null,
        ...values,
      })
      .returning({ id: messages.id });
    return row?.id ?? 0;
  };
  const jobs = async (name: string) =>
    (
      await testDb.database.pool.query<{ data: object }>(
        'select data from pgboss.job where name = $1',
        [name],
      )
    ).rows.map((r) => r.data);
  const message = async (id: number) =>
    (await testDb.database.db.select().from(messages).where(eq(messages.id, id)))[0];

  beforeAll(async () => {
    testDb = await createTestDatabase(testDatabaseUrl ?? '');
    await seed(testDb.database.db);
    boss = await startQueue(testDb.url, { supervise: false, onError: () => undefined });
    const [group] = await testDb.database.db
      .insert(waGroups)
      .values({ jid: 'g@g.us', watched: true })
      .returning({ id: waGroups.id });
    groupId = group?.id ?? 0;
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
    await testDb.drop();
  });
  beforeEach(async () => {
    await testDb.database.pool.query(
      'truncate units, extraction_runs, media_files, messages restart identity cascade; delete from pgboss.job',
    );
  });

  describe('preprocess', () => {
    it('queues text messages for classification', async () => {
      const id = await addMessage({ text: 'شقة للبيع' });
      expect(await preprocess(deps(fakeModel({}).llm), id)).toBe('queued');
      expect((await message(id))?.status).toBe('processing');
      expect(await jobs('classify')).toEqual([{ messageId: id }]);
    });

    it.each<[string, Partial<typeof messages.$inferInsert>, string]>([
      ['voice notes', { mediaType: 'audio' }, 'Voice notes are not processed'],
      [
        'images until Phase 3',
        { mediaType: 'image', text: 'caption' },
        'Media extraction arrives in Phase 3',
      ],
      ['deleted messages', { text: 'x', deletedAt: new Date() }, 'Deleted by the sender'],
      ['empty messages', { text: '  ' }, 'No text'],
    ])('skips %s', async (_label, values, reason) => {
      const id = await addMessage(values);
      if (values.mediaType === 'image') {
        await testDb.database.db
          .insert(mediaFiles)
          .values({ messageId: id, kind: 'image', mediaRef: {} });
      }
      expect(await preprocess(deps(fakeModel({}).llm), id)).toBe('skipped');
      expect(await message(id)).toMatchObject({ status: 'skipped', error: reason });
      expect(await jobs('classify')).toEqual([]);
    });
  });

  describe('classify', () => {
    it('skips chatter without calling the model', async () => {
      const model = fakeModel({ classification: { intent: 'listing' } });
      const id = await addMessage({ text: 'صباح الخير يا جماعة' });
      expect(await classify(deps(model.llm), id)).toBe('not_relevant');
      expect(model.bodies).toEqual([]);
      expect(await message(id)).toMatchObject({
        status: 'skipped',
        error: 'Not relevant: no listing words',
      });
    });

    it('skips what the model calls not relevant', async () => {
      const id = await addMessage({ text: 'حد عنده شقة للبيع في التجمع؟' });
      expect(
        await classify(deps(fakeModel({ classification: { intent: 'not_relevant' } }).llm), id),
      ).toBe('not_relevant');
      expect((await message(id))?.status).toBe('skipped');
    });

    it('queues listings for extraction and records the model call', async () => {
      const id = await addMessage({ text: MULTI_UNIT });
      expect(
        await classify(deps(fakeModel({ classification: { intent: 'listing' } }).llm), id),
      ).toBe('listing');
      expect(await jobs('extract')).toEqual([{ messageId: id, intent: 'listing' }]);
      const runs = await testDb.database.db.select().from(extractionRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        purpose: 'classify',
        provider: 'cerebras',
        model: 'a',
        status: 'ok',
        inputTokens: 500,
        outputTokens: 200,
        costUsd: 0,
        parsed: { intent: 'listing' },
      });
      expect(runs[0]?.promptVersion).toMatch(/^classify-/);
    });

    it('marks the message failed and asks for a retry when every model fails', async () => {
      const id = await addMessage({ text: MULTI_UNIT });
      await expect(classify(deps(fakeModel({ fail: true }).llm), id)).rejects.toThrow(
        RetryableError,
      );
      expect(await message(id)).toMatchObject({ status: 'failed', attempts: 1 });
      expect(await testDb.database.db.select().from(extractionRuns)).toHaveLength(2); // one per model
    });
  });

  describe('extract (acceptance: multi-unit messages, export, privacy)', () => {
    const shared = {
      ...blank,
      developer: 'اعمار',
      project: 'ميفيدا',
      down_payment: 'مقدم 10%',
      installments: 'تقسيط 8 سنين ربع سنوي',
      delivery: 'استلام 2029',
    };
    const extraction = {
      units: [
        {
          ...shared,
          unit_type: 'Apartment',
          bedrooms: '2 غرف',
          area: '120 متر',
          price: 'تبدأ من 7.2 مليون',
          evidence: {
            project: 'ميفيدا',
            unit_type: 'شقق',
            area: '120 متر',
            price: 'تبدأ من 7.2 مليون',
          },
        },
        {
          ...shared,
          unit_type: 'Apartment',
          bedrooms: '3 غرف',
          area: '165 متر',
          price: '9.8 مليون',
          evidence: { project: 'ميفيدا', unit_type: 'شقق', area: '165 متر', price: '9.8 مليون' },
        },
        {
          ...shared,
          unit_type: 'Townhouse',
          area: '210 متر',
          price: '16.5 مليون',
          evidence: {
            project: 'ميفيدا',
            unit_type: 'تاون هاوس',
            area: '210 متر',
            price: '16.5 مليون',
          },
        },
      ],
    };

    it('turns one message into one row per unit type, with values computed in code', async () => {
      const id = await addMessage({ text: MULTI_UNIT });
      expect(await extract(deps(fakeModel({ extraction }).llm), id, 'listing')).toBe(3);
      const rows = await testDb.database.db.select().from(units).orderBy(asc(units.id));
      expect(rows).toHaveLength(3);
      expect(rows.map((u) => [u.unitType, u.bedrooms, u.minArea, u.minPrice, u.maxPrice])).toEqual([
        ['Apartment', 2, 120, 720_000_000, null],
        ['Apartment', 3, 165, 980_000_000, 980_000_000],
        ['Townhouse', null, 210, 1_650_000_000, 1_650_000_000],
      ]);
      for (const row of rows) {
        expect(row).toMatchObject({
          downPayment: 10,
          installmentsCount: 32,
          installmentFrequency: 'quarterly',
          deliveryYear: 2029,
          priceCurrency: 'EGP',
          sourceMessageId: id,
          firstSeenAt: new Date('2026-10-26T09:00:00Z'),
        });
        expect(row.projectId).not.toBeNull();
        expect(row.developerId).not.toBeNull();
        expect(row.cityId).not.toBeNull(); // from the project
      }
      expect((await message(id))?.status).toBe('processed');
    });

    it('exports them with exactly the 26 template headers', async () => {
      const id = await addMessage({ text: MULTI_UNIT });
      await extract(deps(fakeModel({ extraction }).llm), id, 'listing');
      const { file, count } = await exportUnits(testDb.database, { usdToEgp: undefined });
      expect(count).toBe(3);
      expect(await readHeaderRow(file)).toEqual(TEMPLATE_HEADERS);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
      const sheet = workbook.worksheets[0];
      expect(sheet?.columnCount).toBe(26);
      expect(sheet?.getRow(2).values).toEqual([
        undefined,
        'Residential',
        'Emaar Misr',
        'Mivida',
        'New Cairo',
        'Apartment',
        undefined,
        undefined,
        undefined,
        120,
        120,
        undefined,
        undefined,
        undefined,
        7_200_000,
        undefined,
        2029,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        10,
        32,
        2,
      ]);
    });

    it('never sends a phone number to the model, and the stored requests prove it', async () => {
      const model = fakeModel({ classification: { intent: 'listing' }, extraction });
      const id = await addMessage({ text: MULTI_UNIT });
      await classify(deps(model.llm), id);
      await extract(deps(model.llm), id, 'listing');
      const runs = await testDb.database.db
        .select({ request: extractionRuns.request })
        .from(extractionRuns);
      expect(runs).toHaveLength(2);
      for (const sent of [...model.bodies, ...runs.map((r) => JSON.stringify(r.request))]) {
        expect(sent).not.toContain('01001234567');
        expect(sent).toContain('[phone]');
        expect(sent).not.toContain('h'.repeat(64)); // sender hash never sent either
      }
    });

    it('running extraction again replaces the units and keeps every model call', async () => {
      const id = await addMessage({ text: MULTI_UNIT });
      await extract(deps(fakeModel({ extraction }).llm), id, 'listing');
      await extract(deps(fakeModel({ extraction }).llm), id, 'listing');
      expect(await testDb.database.db.select().from(units)).toHaveLength(3);
      expect(await testDb.database.db.select().from(extractionRuns)).toHaveLength(2);
    });

    it('uses the replied-to message as context, and keeps price updates for Phase 4', async () => {
      const original = await addMessage({ text: MULTI_UNIT, waMessageId: 'ORIG' });
      const reply = await addMessage({ text: 'السعر بقى 9.5 مليون', quotedWaMessageId: 'ORIG' });
      const model = fakeModel({
        extraction: { units: [{ ...blank, project: 'ميفيدا', price: 'السعر بقى 9.5 مليون' }] },
      });
      expect(await extract(deps(model.llm), reply, 'price_update')).toBe(0);
      expect(model.bodies[0]).toContain('IT REPLIES TO THIS EARLIER MESSAGE');
      expect(model.bodies[0]).toContain('ميفيدا');
      expect(await testDb.database.db.select().from(units)).toEqual([]);
      expect(await message(reply)).toMatchObject({
        status: 'processed',
        error: 'price_update: applied to existing units in Phase 4',
      });
      expect(original).toBeGreaterThan(0);
    });

    it('stores rows whose columns match the shared unit schema', async () => {
      const id = await addMessage({ text: MULTI_UNIT });
      await extract(deps(fakeModel({ extraction }).llm), id, 'listing');
      const [row] = await testDb.database.db.select().from(units);
      expect(unitSchema.safeParse(row).success).toBe(true);
    });
  });

  describe('matchEntities', () => {
    it.each<[string, string | null, string | null]>([
      ['ميفيدا', 'Mivida', 'exact'],
      ['MIVIDA', 'Mivida', 'exact'],
      ['ميفيدا التجمع', 'Mivida', 'contained'],
      ['كمبوند ميفيدا', 'Mivida', 'contained'],
      ['mivda', 'Mivida', 'fuzzy'],
      ['مشروع غير معروف', null, null],
    ])('project %s → %s', async (input, expected, how) => {
      const { project } = await matchEntities(testDb.database.db, {
        developer: null,
        project: input,
        city: null,
      });
      expect(project?.name ?? null).toBe(expected);
      if (how === 'fuzzy') expect(project?.similarity).toBeLessThan(1);
      if (how === 'exact' || how === 'contained') expect(project?.similarity).toBe(1);
    });

    it('matches cities and developers through their aliases', async () => {
      const result = await matchEntities(testDb.database.db, {
        developer: 'TMG',
        project: null,
        city: 'التجمع الخامس',
      });
      expect(result.developer?.name).toBe('Talaat Moustafa Group');
      expect(result.city?.name).toBe('New Cairo');
    });
  });
});

describe('mightBeListing', () => {
  it.each<[string, boolean]>([
    ['شقة للبيع في التجمع', true],
    ['3BR apartment for sale', true],
    ['يبدأ من 6.5M', true],
    ['150 م', true],
    ['صباح الخير', false],
    ['تمام شكرا', false],
    ['good morning all', false],
  ])('%s → %s', (text, expected) => {
    expect(mightBeListing(text)).toBe(expected);
  });
});
