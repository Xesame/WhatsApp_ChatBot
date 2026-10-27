import { firmNotes, units, users, type Db } from '@reb/db';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { firmOf, ForbiddenError, NotFoundError, type Actor } from './actor.ts';

export const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

export interface FirmNote {
  id: number;
  body: string;
  authorName: string | null;
  mine: boolean;
  createdAt: Date;
}

/** The firm's own notes on a listing, oldest first. Other firms' notes never appear. */
export async function listNotes(db: Db, actor: Actor, unitId: number): Promise<FirmNote[]> {
  const firmId = firmOf(actor);
  const rows = await db
    .select({
      id: firmNotes.id,
      body: firmNotes.body,
      authorId: firmNotes.authorId,
      authorName: users.name,
      createdAt: firmNotes.createdAt,
    })
    .from(firmNotes)
    .leftJoin(users, eq(users.id, firmNotes.authorId))
    .where(and(eq(firmNotes.firmId, firmId), eq(firmNotes.unitId, unitId)))
    .orderBy(asc(firmNotes.createdAt));
  return rows.map(({ authorId, ...r }) => ({ ...r, mine: authorId === actor.userId }));
}

export async function addNote(
  db: Db,
  actor: Actor,
  unitId: number,
  input: { body: string },
): Promise<number> {
  const firmId = firmOf(actor);
  const { body } = noteSchema.parse(input);
  const [unit] = await db
    .select({ id: units.id })
    .from(units)
    .where(and(eq(units.id, unitId), ne(units.status, 'withdrawn')));
  if (!unit) throw new NotFoundError('Listing not found');
  const [row] = await db
    .insert(firmNotes)
    .values({ firmId, unitId, authorId: actor.userId, body })
    .returning({ id: firmNotes.id });
  if (!row) throw new Error('insert failed');
  return row.id;
}

/** The author or a firm admin may delete a note, within their own firm only. */
export async function deleteNote(db: Db, actor: Actor, noteId: number): Promise<void> {
  const firmId = firmOf(actor);
  const [note] = await db
    .select()
    .from(firmNotes)
    .where(and(eq(firmNotes.id, noteId), eq(firmNotes.firmId, firmId)));
  if (!note) throw new NotFoundError('Note not found');
  if (note.authorId !== actor.userId && actor.role !== 'firm_admin') {
    throw new ForbiddenError('Only the author or a firm admin can delete this note');
  }
  await db.delete(firmNotes).where(and(eq(firmNotes.id, noteId), eq(firmNotes.firmId, firmId)));
}
