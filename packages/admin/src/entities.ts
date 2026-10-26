import {
  cities,
  developers,
  entityAliases,
  projects,
  units,
  type Database,
  type Db,
} from '@reb/db';
import { normalizeName } from '@reb/normalize';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { NotFoundError } from './review.ts';

/**
 * Managing canonical cities, developers and projects and their spellings
 * from the admin page (until now: the seed file).
 */

export type EntityKind = 'city' | 'developer' | 'project';

const TABLES = { city: cities, developer: developers, project: projects } as const;
const aliasColumn = (kind: EntityKind) =>
  kind === 'city'
    ? entityAliases.cityId
    : kind === 'developer'
      ? entityAliases.developerId
      : entityAliases.projectId;
const unitColumn = (kind: EntityKind) =>
  kind === 'city' ? units.cityId : kind === 'developer' ? units.developerId : units.projectId;

export interface EntityView {
  id: number;
  nameEn: string;
  nameAr: string;
  developerId?: number;
  cityId?: number;
  aliases: { id: number; alias: string; source: string }[];
  unitCount: number;
}

export async function listEntities(
  db: Db,
  kind: EntityKind,
  search?: string,
): Promise<EntityView[]> {
  const table = TABLES[kind];
  const query = search?.trim();
  const rows = await db
    .select()
    .from(table)
    .where(
      query ? or(ilike(table.nameEn, `%${query}%`), ilike(table.nameAr, `%${query}%`)) : undefined,
    )
    .orderBy(asc(table.nameEn));
  const column = aliasColumn(kind);
  const aliases = await db
    .select({
      id: entityAliases.id,
      alias: entityAliases.alias,
      source: entityAliases.source,
      owner: column,
    })
    .from(entityAliases)
    .where(sql`${column} is not null`);
  const counts = await db
    .select({ owner: unitColumn(kind), count: sql<number>`count(*)::int` })
    .from(units)
    .groupBy(unitColumn(kind));
  return rows.map((row) => ({
    id: row.id,
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    ...('developerId' in row ? { developerId: row.developerId, cityId: row.cityId } : {}),
    aliases: aliases
      .filter((a) => a.owner === row.id)
      .map(({ id, alias, source }) => ({ id, alias, source })),
    unitCount: counts.find((c) => c.owner === row.id)?.count ?? 0,
  }));
}

/** Adds a spelling. Returns false if the same spelling already points at this entity. */
export async function addAlias(
  db: Db,
  kind: EntityKind,
  entityId: number,
  alias: string,
): Promise<boolean> {
  const aliasNormalized = normalizeName(alias);
  if (!aliasNormalized) throw new Error('The alias is empty after normalization');
  const owner =
    kind === 'city'
      ? { cityId: entityId }
      : kind === 'developer'
        ? { developerId: entityId }
        : { projectId: entityId };
  const inserted = await db
    .insert(entityAliases)
    .values({ alias: alias.trim(), aliasNormalized, source: 'manual', ...owner })
    .onConflictDoNothing()
    .returning({ id: entityAliases.id });
  return inserted.length > 0;
}

export async function removeAlias(db: Db, aliasId: number): Promise<void> {
  await db.delete(entityAliases).where(eq(entityAliases.id, aliasId));
}

export async function createEntity(
  db: Db,
  kind: EntityKind,
  input: { nameEn: string; nameAr: string; developerId?: number; cityId?: number },
): Promise<number> {
  let id: number | undefined;
  if (kind === 'project') {
    if (!input.developerId || !input.cityId)
      throw new Error('A project needs a developer and a city');
    [{ id }] = (await db
      .insert(projects)
      .values({
        nameEn: input.nameEn.trim(),
        nameAr: input.nameAr.trim(),
        developerId: input.developerId,
        cityId: input.cityId,
      })
      .returning({ id: projects.id })) as [{ id: number }];
  } else {
    const table = TABLES[kind];
    [{ id }] = (await db
      .insert(table)
      .values({ nameEn: input.nameEn.trim(), nameAr: input.nameAr.trim() })
      .returning({ id: table.id })) as [{ id: number }];
  }
  await addAlias(db, kind, id, input.nameEn);
  await addAlias(db, kind, id, input.nameAr);
  return id;
}

export async function renameEntity(
  db: Db,
  kind: EntityKind,
  id: number,
  input: { nameEn?: string; nameAr?: string },
): Promise<void> {
  const table = TABLES[kind];
  const set: Record<string, string> = {};
  if (input.nameEn?.trim()) set.nameEn = input.nameEn.trim();
  if (input.nameAr?.trim()) set.nameAr = input.nameAr.trim();
  if (Object.keys(set).length === 0) return;
  const updated = await db
    .update(table)
    .set(set)
    .where(eq(table.id, id))
    .returning({ id: table.id });
  if (updated.length === 0) throw new NotFoundError(`${kind} ${id} not found`);
  // the new names become spellings too, so messages using them still match
  for (const name of Object.values(set)) await addAlias(db, kind, id, name);
}

/**
 * Merges a duplicate entity into the right one: its units, projects (for a
 * city or developer) and spellings move over, then the duplicate is
 * deleted. One transaction: it happens completely or not at all.
 */
export async function mergeEntities(
  database: Database,
  kind: EntityKind,
  fromId: number,
  intoId: number,
): Promise<void> {
  if (fromId === intoId) throw new Error('Cannot merge an entity into itself');
  await database.transaction(async (tx) => {
    const table = TABLES[kind];
    const found = await tx
      .select({ id: table.id })
      .from(table)
      .where(or(eq(table.id, fromId), eq(table.id, intoId)));
    if (found.length !== 2) throw new NotFoundError(`${kind} ${fromId} or ${intoId} not found`);

    await tx
      .update(units)
      .set({
        [kind === 'city' ? 'cityId' : kind === 'developer' ? 'developerId' : 'projectId']: intoId,
      })
      .where(eq(unitColumn(kind), fromId));
    if (kind !== 'project') {
      const column = kind === 'city' ? projects.cityId : projects.developerId;
      await tx
        .update(projects)
        .set({ [kind === 'city' ? 'cityId' : 'developerId']: intoId })
        .where(eq(column, fromId));
    }
    const column = aliasColumn(kind);
    const moving = await tx.select().from(entityAliases).where(eq(column, fromId));
    const owner = (id: number) =>
      kind === 'city'
        ? { cityId: id }
        : kind === 'developer'
          ? { developerId: id }
          : { projectId: id };
    for (const alias of moving) {
      await tx
        .insert(entityAliases)
        .values({
          alias: alias.alias,
          aliasNormalized: alias.aliasNormalized,
          source: alias.source,
          ...owner(intoId),
        })
        .onConflictDoNothing();
    }
    await tx.delete(entityAliases).where(and(eq(column, fromId)));
    await tx.delete(table).where(eq(table.id, fromId));
  });
}
