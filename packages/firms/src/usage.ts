import { USAGE_KINDS, usageEvents, type Db } from '@reb/db';
import { firmOf, type Actor } from './actor.ts';

/**
 * Records a search, export or listing view for the person's firm (build
 * plan: exports and searches are logged per firm). The owner's own use is
 * not billed, so it isn't recorded.
 */
export async function recordUsage(
  db: Db,
  actor: Actor,
  kind: (typeof USAGE_KINDS)[number],
  details: Record<string, unknown>,
): Promise<void> {
  if (actor.role === 'owner') return;
  await db
    .insert(usageEvents)
    .values({ firmId: firmOf(actor), userId: actor.userId, kind, details });
}
