/**
 * Plain-English description of every table and column.
 *
 * `pnpm docs` reads this together with the Drizzle schema to generate
 * docs/generated/database.md, and fails if any table or column is missing
 * here. Adding a column therefore forces you to document it.
 */
export const tableDocs: Record<string, { description: string; columns: Record<string, string> }> = {
  cities: {
    description: 'Canonical cities and areas (New Cairo, Sheikh Zayed, North Coast, ...).',
    columns: {
      id: 'Identity primary key.',
      name_en: 'Official English name. Used in exports. Unique.',
      name_ar: 'Official Arabic name.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  developers: {
    description: 'Canonical real estate developers (Emaar Misr, SODIC, Palm Hills, ...).',
    columns: {
      id: 'Identity primary key.',
      name_en: 'Official English name. Used in exports. Unique.',
      name_ar: 'Official Arabic name.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  projects: {
    description: 'Canonical projects (compounds). Each belongs to one developer and one city.',
    columns: {
      id: 'Identity primary key.',
      name_en: 'Official English name. Used in exports. Unique per developer.',
      name_ar: 'Official Arabic name.',
      developer_id: 'The developer that builds this project.',
      city_id: 'The city or area the project is in.',
      created_at: 'When the row was created.',
      updated_at: 'When the row was last changed.',
    },
  },
  entity_aliases: {
    description:
      'Alternate spellings (Arabic, English, abbreviations) mapped to one city, developer or project. Exactly one of the three entity columns is set.',
    columns: {
      id: 'Identity primary key.',
      alias: 'The spelling as written, kept for display and review.',
      alias_normalized:
        'The spelling after normalizeName(): lowercase, unified Arabic letters, no diacritics or punctuation. Matching uses this column.',
      city_id: 'Set when the alias names a city.',
      developer_id: 'Set when the alias names a developer.',
      project_id: 'Set when the alias names a project.',
      source:
        'Where the alias came from: `seed` (seed data), `manual` (added by the owner), `review` (learned from a review-queue correction).',
      created_at: 'When the alias was added.',
    },
  },
};
