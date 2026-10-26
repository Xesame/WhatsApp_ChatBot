import { entityAliases, projects, type Db } from '@reb/db';
import { normalizeName, type EntityMatch, type ProjectMatch } from '@reb/normalize';
import { cities, developers } from '@reb/db';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

/**
 * Finds the canonical city, developer or project for a name as written.
 *
 * 1. Exact: the normalized name equals a known alias.
 * 2. Contained: a known alias appears inside the name ("ميفيدا التجمع"
 *    contains "ميفيدا"); the longest such alias wins.
 * 3. Fuzzy: trigram similarity (pg_trgm) above the threshold catches typos
 *    ("mivda" → Mivida). Fuzzy matches are flagged for review.
 *
 * The threshold: a one-letter typo in a short name scores about 0.43
 * ("mivda"/"mivida" 0.44, "ميفدا"/"ميفيدا" 0.44, "hyde prak" 0.43), so 0.40
 * catches those. Tune it on real data with the eval set.
 */
export const FUZZY_THRESHOLD = 0.4;

type Kind = 'city' | 'developer' | 'project';

const columnFor = (kind: Kind) =>
  kind === 'city'
    ? entityAliases.cityId
    : kind === 'developer'
      ? entityAliases.developerId
      : entityAliases.projectId;

async function findAlias(
  db: Db,
  kind: Kind,
  rawName: string,
): Promise<{ id: number; similarity: number } | null> {
  const name = normalizeName(rawName);
  if (name.length < 2) return null;
  const column = columnFor(kind);

  const [exact] = await db
    .select({ id: column })
    .from(entityAliases)
    .where(and(isNotNull(column), eq(entityAliases.aliasNormalized, name)))
    .limit(1);
  if (exact?.id) return { id: exact.id, similarity: 1 };

  // Whole-word containment, longest alias first. Aliases of 3 characters or
  // fewer ("MV", "D5") only match exactly, to avoid false hits.
  const padded = ` ${name} `;
  const [contained] = await db
    .select({ id: column })
    .from(entityAliases)
    .where(
      and(
        isNotNull(column),
        sql`length(${entityAliases.aliasNormalized}) > 3`,
        sql`position(' ' || ${entityAliases.aliasNormalized} || ' ' in ${padded}) > 0`,
      ),
    )
    .orderBy(desc(sql`length(${entityAliases.aliasNormalized})`))
    .limit(1);
  if (contained?.id) return { id: contained.id, similarity: 1 };

  const similarity = sql<number>`similarity(${entityAliases.aliasNormalized}, ${name})`;
  const [fuzzy] = await db
    .select({ id: column, similarity })
    .from(entityAliases)
    .where(and(isNotNull(column), sql`${similarity} >= ${FUZZY_THRESHOLD}`))
    .orderBy(desc(similarity))
    .limit(1);
  if (fuzzy?.id) return { id: fuzzy.id, similarity: Math.round(fuzzy.similarity * 100) / 100 };
  return null;
}

export interface EntityMatches {
  developer: EntityMatch | null;
  project: ProjectMatch | null;
  city: EntityMatch | null;
}

export async function matchEntities(
  db: Db,
  names: { developer: string | null; project: string | null; city: string | null },
): Promise<EntityMatches> {
  const [developerHit, projectHit, cityHit] = await Promise.all([
    names.developer ? findAlias(db, 'developer', names.developer) : null,
    names.project ? findAlias(db, 'project', names.project) : null,
    names.city ? findAlias(db, 'city', names.city) : null,
  ]);

  const lookup = async <T>(
    hit: { id: number; similarity: number } | null,
    load: (id: number) => Promise<T | undefined>,
  ) => (hit ? { hit, row: await load(hit.id) } : null);

  const developer = await lookup(
    developerHit,
    async (id) =>
      (
        await db.select({ name: developers.nameEn }).from(developers).where(eq(developers.id, id))
      )[0],
  );
  const project = await lookup(
    projectHit,
    async (id) =>
      (
        await db
          .select({
            name: projects.nameEn,
            developerId: projects.developerId,
            cityId: projects.cityId,
          })
          .from(projects)
          .where(eq(projects.id, id))
      )[0],
  );
  const city = await lookup(
    cityHit,
    async (id) =>
      (await db.select({ name: cities.nameEn }).from(cities).where(eq(cities.id, id)))[0],
  );

  return {
    developer: developer?.row
      ? { id: developer.hit.id, similarity: developer.hit.similarity, name: developer.row.name }
      : null,
    project: project?.row
      ? {
          id: project.hit.id,
          similarity: project.hit.similarity,
          name: project.row.name,
          developerId: project.row.developerId,
          cityId: project.row.cityId,
        }
      : null,
    city: city?.row
      ? { id: city.hit.id, similarity: city.hit.similarity, name: city.row.name }
      : null,
  };
}
