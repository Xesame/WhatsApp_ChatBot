import { messages, nameLookups, units, unitSources, waGroups } from '@reb/db';
import { createTestDatabase, testDatabaseUrl, type TestDatabase } from '@reb/db/testing';
import { seed } from '@reb/db/seed-runner';
import { DEFAULT_TOLERANCES } from '@reb/dedup';
import { parseModelList, type LlmClient } from '@reb/llm';
import { startQueue, type PgBoss } from '@reb/queue';
import type { RawUnit } from '@reb/schema';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeModel } from './fake-model.ts';
import {
  extract,
  lookupFor,
  needsLookup,
  queueLookups,
  recheckWaitingUnits,
  runLookup,
  type PipelineDeps,
} from '../src/index.ts';

describe('needsLookup', () => {
  const written = (project: string[], developer: string[] = []) => ({
    written: { developer, project, city: [] },
  });

  it('asks nothing when the project, developer and city are all known', () => {
    expect(
      needsLookup({ projectId: 1, developerId: 2, cityId: 3, extras: written(['Mivida']) }),
    ).toBeNull();
  });

  it('asks about a written project that has no developer', () => {
    expect(
      needsLookup({
        projectId: null,
        developerId: null,
        cityId: 3,
        extras: written(['Lumia Lagoons', 'Lumia']),
      }),
    ).toEqual({ name: 'Lumia Lagoons', developer: null });
  });

  it('passes the written developer along and reads older units from unmatched', () => {
    expect(
      needsLookup({
        projectId: null,
        developerId: null,
        cityId: null,
        extras: written(['Lumia Lagoons'], ['دبي مصر']),
      }),
    ).toEqual({ name: 'Lumia Lagoons', developer: 'دبي مصر' });
    expect(
      needsLookup({
        projectId: null,
        developerId: null,
        cityId: null,
        extras: { unmatched: { project: 'Lumia Lagoons' } },
      }),
    ).toEqual({ name: 'Lumia Lagoons', developer: null });
  });

  it('asks nothing when no project name was written', () => {
    expect(
      needsLookup({ projectId: null, developerId: null, cityId: null, extras: {} }),
    ).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)('name lookups (real Postgres and pg-boss, fake model)', () => {
  let testDb: TestDatabase;
  let boss: PgBoss;
  let groupId: number;
  const logger = pino({ level: 'silent' });
  const MESSAGE_TEXT = 'مشروع لوميا لاجونز شقة 120 متر 7 مليون';
  const SENDER = 'a'.repeat(64);
  const ANSWER = { known: true, developer: 'Dubai Misr', city: 'R8' };

  const deps = (llm: LlmClient, extract = 'gemini:gemini-flash-latest'): PipelineDeps => ({
    database: testDb.database,
    boss,
    llm,
    models: { classify: parseModelList(extract), extract: parseModelList(extract) },
    logger,
    tolerances: DEFAULT_TOLERANCES,
    media: {
      mediaDir: '',
      visionModels: [],
      pdfMaxPages: 10,
      pdfMinTextChars: 20,
      captionWindowSeconds: 120,
    },
  });

  /** A unit whose project "Lumia Lagoons" is not in the lists, from a real message. */
  const waitingUnit = async (project = 'Lumia Lagoons') => {
    const [message] = await testDb.database.db
      .insert(messages)
      .values({
        groupId,
        waMessageId: `W${Math.random()}`,
        senderHash: SENDER,
        sentAt: new Date('2026-11-01T10:00:00Z'),
        text: MESSAGE_TEXT,
      })
      .returning({ id: messages.id });
    const [unit] = await testDb.database.db
      .insert(units)
      .values({
        unitType: 'Apartment',
        minArea: 120,
        maxArea: 120,
        minPrice: 700_000_000,
        maxPrice: 700_000_000,
        confidence: 0.35,
        needsReview: true,
        flaggedOnArrival: true,
        reviewReasons: [`project "${project}" is not in the known list`],
        extras: {
          written: { developer: [], project: [project], city: [] },
          unmatched: { project },
          priceFactor: 1,
        },
        firstSeenAt: new Date('2026-11-01T10:00:00Z'),
        lastSeenAt: new Date('2026-11-01T10:00:00Z'),
      })
      .returning();
    if (!unit || !message) throw new Error('insert failed');
    await testDb.database.db
      .insert(unitSources)
      .values({ unitId: unit.id, messageId: message.id, role: 'listing' });
    return unit;
  };
  const lookupJobs = async () =>
    (
      await testDb.database.pool.query<{ data: { name: string; developer: string | null } }>(
        `select data from pgboss.job where name = 'lookup' and state in ('created', 'retry', 'active')`,
      )
    ).rows.map((r) => r.data);
  const lookupRows = () => testDb.database.db.select().from(nameLookups);
  const ageRow = (days: number) =>
    testDb.database.pool.query(
      `update name_lookups set created_at = now() - make_interval(days => $1),
         updated_at = now() - make_interval(days => $1)`,
      [days],
    );

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
      'truncate name_lookups, unit_prices, unit_sources, units, messages restart identity cascade; delete from pgboss.job',
    );
  });

  it('looks up a project with no developer once', async () => {
    const first = await waitingUnit();
    expect(await queueLookups(testDb.database.db, boss, [first.id])).toBe(1);
    expect(await lookupJobs()).toEqual([{ name: 'Lumia Lagoons', developer: null }]);

    // Asking again while the job is still waiting adds nothing.
    expect(await queueLookups(testDb.database.db, boss, [first.id])).toBe(0);
    expect(await lookupJobs()).toHaveLength(1);

    const model = fakeModel({ lookup: ANSWER });
    expect(await runLookup(deps(model.llm), { name: 'Lumia Lagoons', developer: null })).toBe(
      'done',
    );
    const rows = await lookupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Lumia Lagoons',
      nameNormalized: 'lumia lagoons',
      known: true,
      developer: 'Dubai Misr',
      city: 'R8',
      model: 'gemini:gemini-flash-latest',
    });
    expect(await lookupFor(testDb.database.db, first)).toEqual({
      name: 'Lumia Lagoons',
      ...ANSWER,
    });

    // A second unit with the same name (another spelling of case) reuses the answer.
    await testDb.database.pool.query(`delete from pgboss.job`);
    const second = await waitingUnit('LUMIA  lagoons');
    expect(await queueLookups(testDb.database.db, boss, [second.id])).toBe(0);
    expect(await lookupJobs()).toEqual([]);

    // Running the same job twice asks the model only once.
    await runLookup(deps(model.llm), { name: 'Lumia Lagoons', developer: null });
    expect(model.bodies).toHaveLength(1);
  });

  it('sends only names to the model', async () => {
    await waitingUnit();
    const model = fakeModel({ lookup: ANSWER });
    await runLookup(deps(model.llm), { name: 'Lumia Lagoons', developer: null });
    expect(model.bodies).toHaveLength(1);
    const request = model.bodies[0] ?? '';
    expect(request).toContain('Lumia Lagoons');
    expect(request).not.toContain(MESSAGE_TEXT);
    expect(request).not.toContain('لوميا');
    expect(request).not.toContain(SENDER);
  });

  it('uses Gemini models only', async () => {
    const both = fakeModel({ lookup: ANSWER });
    await runLookup(deps(both.llm, 'groq:openai/gpt-oss-120b,gemini:gemini-flash-latest'), {
      name: 'Lumia Lagoons',
      developer: null,
    });
    expect(both.bodies.map((b) => (JSON.parse(b) as { model: string }).model)).toEqual([
      'gemini-flash-latest',
    ]);

    await testDb.database.pool.query('truncate name_lookups');
    const groqOnly = fakeModel({ lookup: ANSWER });
    expect(
      await runLookup(deps(groqOnly.llm, 'groq:openai/gpt-oss-120b'), {
        name: 'Lumia Lagoons',
        developer: null,
      }),
    ).toBe('done');
    expect(groqOnly.bodies).toEqual([]);
    expect(await lookupRows()).toEqual([]);
  });

  it('waits while messages are being extracted', async () => {
    await boss.send('extract', { messageId: 1, intent: 'listing' });
    const model = fakeModel({ lookup: ANSWER });
    expect(await runLookup(deps(model.llm), { name: 'Lumia Lagoons', developer: null })).toBe(
      'waiting',
    );
    expect(model.bodies).toEqual([]);
    expect(await lookupRows()).toEqual([]);
  });

  it('is queued after a message is extracted and after a re-check changes a unit', async () => {
    const blank: RawUnit = {
      category: null,
      developer: null,
      project: null,
      city: null,
      unit_type: null,
      unit_code: null,
      floor: null,
      building: null,
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
      payment_plans: [],
      notes: null,
      evidence: { project: null, unit_type: null, area: null, price: null },
    };
    const [message] = await testDb.database.db
      .insert(messages)
      .values({
        groupId,
        waMessageId: `W${Math.random()}`,
        senderHash: SENDER,
        sentAt: new Date('2026-11-01T10:00:00Z'),
        text: 'Lumia Lagoons apartment 120 m 7 million',
      })
      .returning({ id: messages.id });
    const model = fakeModel({
      extraction: {
        units: [
          {
            ...blank,
            project: 'Lumia Lagoons',
            unit_type: 'Apartment',
            area: '120 m',
            price: '7 million',
          },
        ],
      },
    });
    await extract(deps(model.llm), message?.id ?? 0, 'listing');
    expect(await lookupJobs()).toEqual([{ name: 'Lumia Lagoons', developer: null }]);

    // A re-check that changes a unit queues its lookup too.
    await testDb.database.pool.query(
      'truncate unit_prices, unit_sources, units restart identity cascade; delete from pgboss.job',
    );
    const unit = await waitingUnit('Lumia Bay');
    await testDb.database.db
      .update(units)
      .set({ reviewReasons: [], confidence: 0.99 })
      .where(eq(units.id, unit.id));
    await recheckWaitingUnits(testDb.database, { boss });
    expect(await lookupJobs()).toEqual([{ name: 'Lumia Bay', developer: null }]);
  });

  it('asks again about unknown names after 30 days', async () => {
    const unit = await waitingUnit();
    const unsure = fakeModel({ lookup: { known: false, developer: null, city: null } });
    await runLookup(deps(unsure.llm), { name: 'Lumia Lagoons', developer: null });
    expect((await lookupRows())[0]).toMatchObject({ known: false, developer: null, city: null });

    await ageRow(5);
    expect(await queueLookups(testDb.database.db, boss, [unit.id])).toBe(0);

    await ageRow(31);
    expect(await queueLookups(testDb.database.db, boss, [unit.id])).toBe(1);
    const model = fakeModel({ lookup: ANSWER });
    await runLookup(deps(model.llm), { name: 'Lumia Lagoons', developer: null });
    const rows = await lookupRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ known: true, developer: 'Dubai Misr' });
  });
});
