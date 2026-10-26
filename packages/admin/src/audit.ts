import { auditLog, type Db } from '@reb/db';

export interface AuditEntry {
  userId: string | null;
  action: string;
  target?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/** Records who did what (build plan, section 11). Never pass passwords here. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    userId: entry.userId,
    action: entry.action,
    target: entry.target ?? null,
    details: entry.details ?? null,
    ipAddress: entry.ipAddress ?? null,
  });
}
