import {
  CASH_DISCOUNT_TYPES,
  CATEGORIES,
  CURRENCIES,
  FINISHING_SPECS,
  INSTALLMENT_FREQUENCIES,
  MAINTENANCE_CURRENCIES,
  UNIT_STATUSES,
  UNIT_TYPES,
} from '@reb/schema';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { mediaFiles, messages } from './capture.ts';
import { cities, developers, projects } from './entities.ts';

/**
 * Listing tables (Phase 2). The allowed values come from @reb/schema, the
 * single definition of the listing fields, and are enforced by CHECK
 * constraints.
 */

const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(
    name,
    sql`${column} in (${sql.join(
      values.map((v) => sql.raw(`'${v.replaceAll("'", "''")}'`)),
      sql`, `,
    )})`,
  );

const decimal = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });

export const EXTRACTION_PURPOSES = ['classify', 'extract', 'transcribe'] as const;
export const RUN_STATUSES = ['ok', 'invalid', 'error', 'rate_limited', 'timeout'] as const;

/** Every model call: what was sent, what came back, cost and timing. */
export const extractionRuns = pgTable(
  'extraction_runs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    messageId: bigint('message_id', { mode: 'number' })
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    /** For `transcribe` runs: the media file that was read. */
    mediaFileId: bigint('media_file_id', { mode: 'number' }).references(() => mediaFiles.id, {
      onDelete: 'cascade',
    }),
    purpose: text('purpose', { enum: EXTRACTION_PURPOSES }).notNull(),
    promptVersion: text('prompt_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    request: jsonb('request').notNull(),
    rawOutput: text('raw_output'),
    parsed: jsonb('parsed'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6, mode: 'number' }),
    latencyMs: integer('latency_ms').notNull(),
    status: text('status', { enum: RUN_STATUSES }).notNull(),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('extraction_runs_message_idx').on(t.messageId),
    index('extraction_runs_created_at_idx').on(t.createdAt),
    oneOf('extraction_runs_purpose_check', t.purpose, EXTRACTION_PURPOSES),
    oneOf('extraction_runs_status_check', t.status, RUN_STATUSES),
  ],
);

/**
 * One row per unit offering: the 26 Primary Units template columns, then
 * internal columns. Prices are integers in minor units (piastres / cents)
 * with `price_currency`.
 */
export const units = pgTable(
  'units',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    // Template columns, in template order.
    category: text('category', { enum: CATEGORIES }),
    developerId: integer('developer_id').references(() => developers.id, { onDelete: 'restrict' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    cityId: integer('city_id').references(() => cities.id, { onDelete: 'restrict' }),
    unitType: text('unit_type', { enum: UNIT_TYPES }),
    unitCode: text('unit_code'),
    floor: text('floor'),
    finishingSpecs: text('finishing_specs', { enum: FINISHING_SPECS }),
    minArea: decimal('min_area'),
    maxArea: decimal('max_area'),
    landArea: decimal('land_area'),
    gardenArea: decimal('garden_area'),
    outdoorArea: decimal('outdoor_area'),
    minPrice: bigint('min_price', { mode: 'number' }),
    maxPrice: bigint('max_price', { mode: 'number' }),
    deliveryYear: smallint('delivery_year'),
    maintenance: decimal('maintenance'),
    maintenanceCurrency: text('maintenance_currency', { enum: MAINTENANCE_CURRENCIES }),
    cashDiscount: decimal('cash_discount'),
    cashDiscountCurrency: text('cash_discount_currency', { enum: CURRENCIES }),
    cashDiscountType: text('cash_discount_type', { enum: CASH_DISCOUNT_TYPES }),
    downPayment: decimal('down_payment'),
    installmentsCount: smallint('installments_count'),
    bedrooms: smallint('bedrooms'),
    bathrooms: smallint('bathrooms'),
    notes: text('notes'),
    // Internal columns (never exported).
    status: text('status', { enum: UNIT_STATUSES }).notNull().default('active'),
    priceCurrency: text('price_currency', { enum: CURRENCIES }).notNull().default('EGP'),
    downPaymentAmount: bigint('down_payment_amount', { mode: 'number' }),
    installmentYears: decimal('installment_years'),
    installmentFrequency: text('installment_frequency', { enum: INSTALLMENT_FREQUENCIES }),
    readyToMove: boolean('ready_to_move').notNull().default(false),
    confidence: numeric('confidence', { precision: 3, scale: 2, mode: 'number' }).notNull(),
    needsReview: boolean('needs_review').notNull(),
    reviewReasons: text('review_reasons')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    extras: jsonb('extras').notNull().default({}),
    // Set when a sold notice marked the unit sold, so reprocessing that
    // notice can undo it.
    soldByMessageId: bigint('sold_by_message_id', { mode: 'number' }).references(
      () => messages.id,
      {
        onDelete: 'set null',
      },
    ),
    extractionRunId: bigint('extraction_run_id', { mode: 'number' }).references(
      () => extractionRuns.id,
      {
        onDelete: 'set null',
      },
    ),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Dedup looks up candidates by project and unit type.
    index('units_project_type_status_idx').on(t.projectId, t.unitType, t.status),
    index('units_city_type_idx').on(t.cityId, t.unitType),
    index('units_status_idx').on(t.status),
    index('units_needs_review_idx')
      .on(t.needsReview)
      .where(sql`${t.needsReview}`),
    oneOf('units_category_check', t.category, CATEGORIES),
    oneOf('units_unit_type_check', t.unitType, UNIT_TYPES),
    oneOf('units_finishing_specs_check', t.finishingSpecs, FINISHING_SPECS),
    oneOf('units_maintenance_currency_check', t.maintenanceCurrency, MAINTENANCE_CURRENCIES),
    oneOf('units_cash_discount_currency_check', t.cashDiscountCurrency, CURRENCIES),
    oneOf('units_cash_discount_type_check', t.cashDiscountType, CASH_DISCOUNT_TYPES),
    oneOf('units_status_check', t.status, UNIT_STATUSES),
    oneOf('units_price_currency_check', t.priceCurrency, CURRENCIES),
    oneOf('units_installment_frequency_check', t.installmentFrequency, INSTALLMENT_FREQUENCIES),
    check('units_down_payment_range', sql`${t.downPayment} between 0 and 100`),
    check(
      'units_price_order',
      sql`${t.maxPrice} is null or ${t.minPrice} is null or ${t.minPrice} <= ${t.maxPrice}`,
    ),
  ],
);

export const SOURCE_ROLES = ['listing', 'price_update', 'sold'] as const;

/**
 * Every message that mentioned a unit. Dedup keeps one unit and adds a row
 * here for each repost, price update or sold notice.
 */
export const unitSources = pgTable(
  'unit_sources',
  {
    unitId: bigint('unit_id', { mode: 'number' })
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    messageId: bigint('message_id', { mode: 'number' })
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    role: text('role', { enum: SOURCE_ROLES }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.unitId, t.messageId] }),
    index('unit_sources_message_idx').on(t.messageId),
    oneOf('unit_sources_role_check', t.role, SOURCE_ROLES),
  ],
);

/**
 * Price history: one row per observed change of price or payment terms.
 * A repost with the same terms adds a source, not a price row. The unit's
 * own price columns always hold the latest observation.
 */
export const unitPrices = pgTable(
  'unit_prices',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    unitId: bigint('unit_id', { mode: 'number' })
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    minPrice: bigint('min_price', { mode: 'number' }),
    maxPrice: bigint('max_price', { mode: 'number' }),
    priceCurrency: text('price_currency', { enum: CURRENCIES }).notNull(),
    downPayment: decimal('down_payment'),
    downPaymentAmount: bigint('down_payment_amount', { mode: 'number' }),
    installmentsCount: smallint('installments_count'),
    installmentYears: decimal('installment_years'),
    installmentFrequency: text('installment_frequency', { enum: INSTALLMENT_FREQUENCIES }),
    cashDiscount: decimal('cash_discount'),
    cashDiscountType: text('cash_discount_type', { enum: CASH_DISCOUNT_TYPES }),
    cashDiscountCurrency: text('cash_discount_currency', { enum: CURRENCIES }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    sourceMessageId: bigint('source_message_id', { mode: 'number' })
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('unit_prices_unit_observed_idx').on(t.unitId, t.observedAt),
    index('unit_prices_message_idx').on(t.sourceMessageId),
    oneOf('unit_prices_price_currency_check', t.priceCurrency, CURRENCIES),
  ],
);
