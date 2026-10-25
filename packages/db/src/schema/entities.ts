import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Canonical entities: the single "official" record for each city, developer
 * and project. Listings point at these rows, never at free text, so a search
 * for "New Cairo" finds listings that were posted as "التجمع" or "5th
 * Settlement".
 *
 * Integer identity IDs (1, 2, 3 ...) are used instead of UUIDs because these
 * tables are small and Hassan will read and type these IDs by hand.
 */

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const cities = pgTable('cities', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  nameEn: text('name_en').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  ...timestamps,
});

export const developers = pgTable('developers', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  nameEn: text('name_en').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  ...timestamps,
});

export const projects = pgTable(
  'projects',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    nameEn: text('name_en').notNull(),
    nameAr: text('name_ar').notNull(),
    // RESTRICT: a developer or city cannot be deleted while projects use it.
    // Merging duplicates (Phase 5) moves projects first, then deletes.
    developerId: integer('developer_id')
      .notNull()
      .references(() => developers.id, { onDelete: 'restrict' }),
    cityId: integer('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    // Two developers can each have a project called "Park View", but one
    // developer cannot have two projects with the same English name.
    uniqueIndex('projects_developer_name_en_key').on(t.developerId, t.nameEn),
    index('projects_city_id_idx').on(t.cityId),
  ],
);

/**
 * Alternate spellings of a city, developer or project, in any script.
 *
 * Each alias row points at exactly one entity through one of three nullable
 * foreign keys (enforced by the CHECK constraint). Three real foreign keys,
 * rather than a generic "entity_type + entity_id" pair, let Postgres guarantee
 * that an alias never points at a deleted entity.
 *
 * `alias_normalized` is the output of `normalizeName()` from
 * @reb/normalize. Matching always compares normalized forms.
 */
export const entityAliases = pgTable(
  'entity_aliases',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    alias: text('alias').notNull(),
    aliasNormalized: text('alias_normalized').notNull(),
    cityId: integer('city_id').references(() => cities.id, { onDelete: 'cascade' }),
    developerId: integer('developer_id').references(() => developers.id, { onDelete: 'cascade' }),
    projectId: integer('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['seed', 'manual', 'review'] })
      .notNull()
      .default('manual'),
    createdAt: timestamps.createdAt,
  },
  (t) => [
    check(
      'entity_aliases_exactly_one_entity',
      sql`num_nonnulls(${t.cityId}, ${t.developerId}, ${t.projectId}) = 1`,
    ),
    // The same spelling may not point at the same entity twice. Postgres
    // treats NULLs as distinct, so a city alias never collides with a
    // developer alias here.
    uniqueIndex('entity_aliases_city_alias_key').on(t.cityId, t.aliasNormalized),
    uniqueIndex('entity_aliases_developer_alias_key').on(t.developerId, t.aliasNormalized),
    uniqueIndex('entity_aliases_project_alias_key').on(t.projectId, t.aliasNormalized),
    // Trigram index: fast fuzzy lookups ("mivda" finds "mivida") with the
    // pg_trgm `%` and similarity() operators.
    index('entity_aliases_alias_trgm_idx').using('gin', sql`${t.aliasNormalized} gin_trgm_ops`),
  ],
);
