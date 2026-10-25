import { loadConfigOrExit } from '@reb/config';
import { normalizeName } from '@reb/normalize';
import { sql } from 'drizzle-orm';
import * as seedData from '../seed/index.ts';
import type { SeedEntity, SeedProject } from '../seed/index.ts';
import { createDatabase, type Db } from './client.ts';
import { cities, developers, entityAliases, projects } from './schema/index.ts';

export interface SeedData {
  cities: SeedEntity[];
  developers: SeedEntity[];
  projects: SeedProject[];
}

export interface SeedSummary {
  cities: number;
  developers: number;
  projects: number;
  aliasesAdded: number;
}

/** Every spelling of an entity (names plus aliases), de-duplicated by normalized form. */
export function spellingsOf(entity: SeedEntity): { alias: string; aliasNormalized: string }[] {
  const seen = new Map<string, string>();
  for (const alias of [entity.nameEn, entity.nameAr, ...entity.aliases]) {
    const normalized = normalizeName(alias);
    if (normalized && !seen.has(normalized)) seen.set(normalized, alias.trim());
  }
  return [...seen].map(([aliasNormalized, alias]) => ({ alias, aliasNormalized }));
}

/**
 * Checks the seed data for mistakes before touching the database:
 * duplicate names, projects pointing at unknown developers or cities, and an
 * alias that would point at two different entities of the same kind (which
 * would make matching ambiguous). Returns a list of human-readable problems.
 */
export function validateSeedData(data: SeedData): string[] {
  const problems: string[] = [];

  const checkKind = (kind: string, entities: SeedEntity[]) => {
    const names = new Set<string>();
    const aliasOwner = new Map<string, string>();
    for (const entity of entities) {
      if (names.has(entity.nameEn)) problems.push(`${kind}: duplicate name "${entity.nameEn}"`);
      names.add(entity.nameEn);
      for (const { alias, aliasNormalized } of spellingsOf(entity)) {
        const owner = aliasOwner.get(aliasNormalized);
        if (owner !== undefined && owner !== entity.nameEn) {
          problems.push(
            `${kind}: alias "${alias}" points at both "${owner}" and "${entity.nameEn}"`,
          );
        }
        aliasOwner.set(aliasNormalized, entity.nameEn);
      }
    }
    return names;
  };

  const cityNames = checkKind('city', data.cities);
  const developerNames = checkKind('developer', data.developers);
  checkKind('project', data.projects);

  for (const project of data.projects) {
    if (!developerNames.has(project.developer)) {
      problems.push(`project "${project.nameEn}": unknown developer "${project.developer}"`);
    }
    if (!cityNames.has(project.city)) {
      problems.push(`project "${project.nameEn}": unknown city "${project.city}"`);
    }
  }
  return problems;
}

/**
 * Loads the starter cities, developers, projects and aliases.
 *
 * Safe to run any number of times: existing rows are matched by English name
 * and updated, and aliases that already exist are skipped. It never deletes
 * anything, so aliases added by hand or through the review queue survive.
 * To rename an entity, rename it in the admin UI (Phase 5) or by migration,
 * not by editing the seed file, which would create a second row.
 */
export async function seed(db: Db, data: SeedData = seedData): Promise<SeedSummary> {
  const problems = validateSeedData(data);
  if (problems.length > 0) {
    throw new Error(`Seed data has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  }

  return db.transaction(async (tx) => {
    let aliasesAdded = 0;
    const addAliases = async (
      entity: SeedEntity,
      owner: { cityId: number } | { developerId: number } | { projectId: number },
    ) => {
      const rows = spellingsOf(entity).map((s) => ({ ...s, ...owner, source: 'seed' as const }));
      const inserted = await tx
        .insert(entityAliases)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: entityAliases.id });
      aliasesAdded += inserted.length;
    };

    const cityIds = new Map<string, number>();
    for (const city of data.cities) {
      const [row] = await tx
        .insert(cities)
        .values({ nameEn: city.nameEn, nameAr: city.nameAr })
        .onConflictDoUpdate({ target: cities.nameEn, set: { nameAr: sql`excluded.name_ar` } })
        .returning({ id: cities.id });
      if (!row) throw new Error(`Failed to upsert city ${city.nameEn}`);
      cityIds.set(city.nameEn, row.id);
      await addAliases(city, { cityId: row.id });
    }

    const developerIds = new Map<string, number>();
    for (const developer of data.developers) {
      const [row] = await tx
        .insert(developers)
        .values({ nameEn: developer.nameEn, nameAr: developer.nameAr })
        .onConflictDoUpdate({ target: developers.nameEn, set: { nameAr: sql`excluded.name_ar` } })
        .returning({ id: developers.id });
      if (!row) throw new Error(`Failed to upsert developer ${developer.nameEn}`);
      developerIds.set(developer.nameEn, row.id);
      await addAliases(developer, { developerId: row.id });
    }

    for (const project of data.projects) {
      // validateSeedData already guaranteed both lookups succeed.
      const developerId = developerIds.get(project.developer) ?? 0;
      const cityId = cityIds.get(project.city) ?? 0;
      const [row] = await tx
        .insert(projects)
        .values({ nameEn: project.nameEn, nameAr: project.nameAr, developerId, cityId })
        .onConflictDoUpdate({
          target: [projects.developerId, projects.nameEn],
          set: { nameAr: sql`excluded.name_ar`, cityId: sql`excluded.city_id` },
        })
        .returning({ id: projects.id });
      if (!row) throw new Error(`Failed to upsert project ${project.nameEn}`);
      await addAliases(project, { projectId: row.id });
    }

    return {
      cities: data.cities.length,
      developers: data.developers.length,
      projects: data.projects.length,
      aliasesAdded,
    };
  });
}

if (import.meta.main) {
  const config = loadConfigOrExit();
  const database = createDatabase(config.DATABASE_URL, { max: 1 });
  try {
    const summary = await seed(database.db);
    console.log(
      `Seed loaded: ${summary.cities} cities, ${summary.developers} developers, ` +
        `${summary.projects} projects, ${summary.aliasesAdded} new aliases.`,
    );
  } finally {
    await database.close();
  }
}
