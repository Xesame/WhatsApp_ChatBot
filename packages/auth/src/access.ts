import { firms, users, type Db } from '@reb/db';
import { eq } from 'drizzle-orm';

export type AccessProblem = 'unknown_user' | 'disabled' | 'firm_suspended' | 'contract_ended';

/**
 * Why a user may not use the service right now, or null if they may. Checked
 * when they sign in and again on every request, so removing a person or
 * suspending a firm takes effect at once.
 */
export async function accessProblem(
  db: Db,
  userId: string,
  today: Date = new Date(),
): Promise<AccessProblem | null> {
  const [row] = await db
    .select({
      disabled: users.disabled,
      status: firms.status,
      contractEnd: firms.contractEnd,
      role: users.role,
    })
    .from(users)
    .leftJoin(firms, eq(firms.id, users.firmId))
    .where(eq(users.id, userId));
  if (!row) return 'unknown_user';
  if (row.disabled) return 'disabled';
  if (row.role === 'owner') return null;
  if (row.status !== 'active') return 'firm_suspended';
  if (row.contractEnd && row.contractEnd < today.toISOString().slice(0, 10))
    return 'contract_ended';
  return null;
}
